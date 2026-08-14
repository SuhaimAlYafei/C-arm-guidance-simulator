from __future__ import annotations

import argparse, csv, json, random, time
from pathlib import Path

import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms
from tqdm import tqdm

CLASSES = ["ELBOW", "FINGER", "FOREARM", "HAND", "HUMERUS", "SHOULDER", "WRIST"]
C2I = {c:i for i,c in enumerate(CLASSES)}


def parse_rows(csv_path: Path):
    rows=[]
    with csv_path.open("r",encoding="utf-8-sig",newline="") as f:
        for r in csv.DictReader(f):
            p=r.get("file_name","").replace("\\","/").strip()
            parts=p.split("/")
            if len(parts)<5 or parts[0] not in {"train","valid"}: continue
            if Path(parts[-1]).name.startswith("._") or "__MACOSX" in parts: continue
            if not parts[1].startswith("XR_"): continue
            a=parts[1][3:].upper()
            if a not in C2I: continue
            rows.append((p,parts[0],a,parts[2]))
    return rows


def find_root(data_root: Path, probe: str):
    for b in [data_root/data_root.name, data_root/"images", data_root]:
        if (b/Path(probe)).is_file(): return b
    img=data_root/"images"
    if img.exists():
        for child in img.iterdir():
            if child.is_dir() and (child/Path(probe)).is_file(): return child
    raise FileNotFoundError("Could not locate extracted MURA image root")


class DS(Dataset):
    def __init__(self, rows, root, tf): self.rows,self.root,self.tf=rows,root,tf
    def __len__(self): return len(self.rows)
    def __getitem__(self,i):
        rel,_,a,_=self.rows[i]
        with Image.open(self.root/Path(rel)) as im:
            x=self.tf(im.convert("RGB"))
        return x,C2I[a]


def metrics(pred, y):
    n=len(CLASSES); cm=[[0]*n for _ in range(n)]
    for a,b in zip(y,pred): cm[a][b]+=1
    total=sum(map(sum,cm)); correct=sum(cm[i][i] for i in range(n))
    recalls=[]; per={}
    for i,c in enumerate(CLASSES):
        sup=sum(cm[i]); pr=sum(cm[r][i] for r in range(n)); tp=cm[i][i]
        rec=tp/sup if sup else 0; prec=tp/pr if pr else 0
        f1=2*prec*rec/(prec+rec) if prec+rec else 0
        recalls.append(rec); per[c]={"support":sup,"precision":prec,"recall":rec,"f1":f1}
    return {"accuracy":correct/total,"balanced_accuracy":sum(recalls)/n,"confusion_matrix":cm,"per_class":per}


def run_epoch(model, loader, loss_fn, device, opt=None, scaler=None, desc=""):
    train=opt is not None; model.train(train)
    losses=0.; preds=[]; ys=[]
    bar=tqdm(loader,desc=desc,dynamic_ncols=True)
    for x,y in bar:
        x=x.to(device,non_blocking=True,memory_format=torch.channels_last)
        y=y.to(device,non_blocking=True)
        if train: opt.zero_grad(set_to_none=True)
        with torch.autocast(device_type="cuda",dtype=torch.float16,enabled=device.type=="cuda"):
            out=model(x); loss=loss_fn(out,y)
        if train:
            scaler.scale(loss).backward(); scaler.step(opt); scaler.update()
        losses += loss.item()*y.size(0)
        p=out.argmax(1); preds.extend(p.detach().cpu().tolist()); ys.extend(y.detach().cpu().tolist())
        bar.set_postfix(loss=f"{loss.item():.3f}")
    m=metrics(preds,ys); m["loss"]=losses/len(loader.dataset); return m


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data-root",type=Path,required=True)
    ap.add_argument("--epochs",type=int,default=8)
    ap.add_argument("--batch-size",type=int,default=64)
    ap.add_argument("--workers",type=int,default=8)
    ap.add_argument("--image-size",type=int,default=224)
    ap.add_argument("--lr",type=float,default=3e-4)
    ap.add_argument("--output",type=Path,default=Path("results/mura_anatomy_fast"))
    args=ap.parse_args()

    torch.backends.cudnn.benchmark=True
    random.seed(23112); torch.manual_seed(23112)
    rows=parse_rows(args.data_root/"mura_v1_1.csv")
    root=find_root(args.data_root,rows[0][0])
    tr=[r for r in rows if r[1]=="train"]; va=[r for r in rows if r[1]=="valid"]
    print(f"Images: train={len(tr)} valid={len(va)} root={root}")

    tf_tr=transforms.Compose([transforms.Resize((args.image_size,args.image_size)),transforms.RandomRotation(5),transforms.RandomAffine(0,translate=(.03,.03),scale=(.95,1.05)),transforms.ColorJitter(.08,.08),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
    tf_va=transforms.Compose([transforms.Resize((args.image_size,args.image_size)),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
    device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("Device:",device, torch.cuda.get_device_name(0) if device.type=="cuda" else "")
    if device.type!="cuda": raise SystemExit("CUDA required for fast trainer")

    trl=DataLoader(DS(tr,root,tf_tr),batch_size=args.batch_size,shuffle=True,num_workers=args.workers,pin_memory=True,persistent_workers=args.workers>0,prefetch_factor=4)
    val=DataLoader(DS(va,root,tf_va),batch_size=args.batch_size,shuffle=False,num_workers=args.workers,pin_memory=True,persistent_workers=args.workers>0,prefetch_factor=4)
    model=models.resnet18(weights=models.ResNet18_Weights.DEFAULT)
    model.fc=nn.Linear(model.fc.in_features,len(CLASSES)); model=model.to(device,memory_format=torch.channels_last)
    opt=torch.optim.AdamW(model.parameters(),lr=args.lr,weight_decay=1e-4)
    loss_fn=nn.CrossEntropyLoss(); scaler=torch.amp.GradScaler("cuda")
    args.output.mkdir(parents=True,exist_ok=True)
    best=-1; history=[]
    for e in range(1,args.epochs+1):
        t=time.time(); tm=run_epoch(model,trl,loss_fn,device,opt,scaler,f"train {e}/{args.epochs}")
        with torch.no_grad(): vm=run_epoch(model,val,loss_fn,device,None,None,f"valid {e}/{args.epochs}")
        rec={"epoch":e,"seconds":round(time.time()-t,2),"train":tm,"valid":vm}; history.append(rec)
        (args.output/"history.json").write_text(json.dumps(history,indent=2),encoding="utf-8")
        ck={"epoch":e,"classes":CLASSES,"model":model.state_dict(),"optimizer":opt.state_dict(),"metrics":vm}
        torch.save(ck,args.output/"last_checkpoint.pt")
        if vm["balanced_accuracy"]>best:
            best=vm["balanced_accuracy"]; torch.save(ck,args.output/"best_checkpoint.pt"); (args.output/"best_metrics.json").write_text(json.dumps(rec,indent=2),encoding="utf-8")
        print(f"Epoch {e}/{args.epochs}: train_acc={tm['accuracy']:.4f} valid_acc={vm['accuracy']:.4f} balanced={vm['balanced_accuracy']:.4f} time={rec['seconds']}s")
    print("Best balanced accuracy:",round(best,4))

if __name__=="__main__": main()
