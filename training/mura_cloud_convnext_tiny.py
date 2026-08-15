from __future__ import annotations

import argparse, csv, json, random, time
from pathlib import Path

import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms
from tqdm import tqdm

CLASSES=["ELBOW","FINGER","FOREARM","HAND","HUMERUS","SHOULDER","WRIST"]
C2I={c:i for i,c in enumerate(CLASSES)}


def parse_rows(p):
    rows=[]
    with p.open("r",encoding="utf-8-sig",newline="") as f:
        for r in csv.DictReader(f):
            q=r.get("file_name","").replace("\\","/").strip(); z=q.split("/")
            if len(z)<5 or z[0] not in {"train","valid"}: continue
            if Path(z[-1]).name.startswith("._") or "__MACOSX" in z or not z[1].startswith("XR_"): continue
            a=z[1][3:].upper()
            if a in C2I: rows.append((q,z[0],a))
    return rows


def find_root(d,probe):
    candidates=[d/d.name,d/"images",d]
    for b in candidates:
        if (b/Path(probe)).is_file(): return b
    img=d/"images"
    if img.exists():
        for c in img.iterdir():
            if c.is_dir() and (c/Path(probe)).is_file(): return c
    raise FileNotFoundError("MURA image root not found")


class DS(Dataset):
    def __init__(self,r,root,tf): self.r,self.root,self.tf=r,root,tf
    def __len__(self): return len(self.r)
    def __getitem__(self,i):
        p,_,a=self.r[i]
        with Image.open(self.root/Path(p)) as im: x=self.tf(im.convert("RGB"))
        return x,C2I[a]


def metrics(pred,y):
    n=len(CLASSES); cm=[[0]*n for _ in range(n)]
    for a,b in zip(y,pred): cm[a][b]+=1
    total=sum(map(sum,cm)); correct=sum(cm[i][i] for i in range(n)); recalls=[]; f1s=[]; per={}
    for i,c in enumerate(CLASSES):
        tp=cm[i][i]; sup=sum(cm[i]); pr=sum(cm[r][i] for r in range(n)); rec=tp/sup if sup else 0.; prec=tp/pr if pr else 0.; f1=2*prec*rec/(prec+rec) if prec+rec else 0.
        recalls.append(rec); f1s.append(f1); per[c]={"support":sup,"precision":prec,"recall":rec,"f1":f1}
    return {"accuracy":correct/total,"balanced_accuracy":sum(recalls)/n,"macro_f1":sum(f1s)/n,"per_class":per,"confusion_matrix":cm}


def run_epoch(model,loader,loss_fn,device,opt=None,scaler=None,desc=""):
    train=opt is not None; model.train(train); ps=[]; ys=[]; loss_sum=0.
    bar=tqdm(loader,desc=desc,dynamic_ncols=True)
    for x,y in bar:
        x=x.to(device,non_blocking=True,memory_format=torch.channels_last); y=y.to(device,non_blocking=True)
        if train: opt.zero_grad(set_to_none=True)
        with torch.autocast(device_type="cuda",dtype=torch.float16,enabled=device.type=="cuda"):
            out=model(x); loss=loss_fn(out,y)
        if train:
            scaler.scale(loss).backward(); scaler.step(opt); scaler.update()
        loss_sum+=loss.item()*y.size(0); ps.extend(out.argmax(1).detach().cpu().tolist()); ys.extend(y.detach().cpu().tolist())
        bar.set_postfix(loss=f"{loss.item():.3f}")
    m=metrics(ps,ys); m["loss"]=loss_sum/len(loader.dataset); return m


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data-root",type=Path,required=True)
    ap.add_argument("--epochs",type=int,default=40)
    ap.add_argument("--batch-size",type=int,default=128)
    ap.add_argument("--workers",type=int,default=16)
    ap.add_argument("--image-size",type=int,default=384)
    ap.add_argument("--lr",type=float,default=2e-4)
    ap.add_argument("--seed",type=int,default=23112)
    ap.add_argument("--early-stop-patience",type=int,default=8)
    ap.add_argument("--output",type=Path,default=Path("results/mura_convnext_tiny_384"))
    args=ap.parse_args()

    random.seed(args.seed); torch.manual_seed(args.seed); torch.cuda.manual_seed_all(args.seed)
    torch.backends.cudnn.benchmark=True
    torch.set_float32_matmul_precision("high")

    rows=parse_rows(args.data_root/"mura_v1_1.csv"); root=find_root(args.data_root,rows[0][0]); tr=[r for r in rows if r[1]=="train"]; va=[r for r in rows if r[1]=="valid"]
    print(f"Images: train={len(tr)} valid={len(va)} root={root}")
    print(f"Model=convnext_tiny size={args.image_size} batch={args.batch_size} seed={args.seed}")

    ttr=transforms.Compose([
        transforms.Resize((args.image_size,args.image_size)),
        transforms.RandomRotation(5),
        transforms.RandomAffine(0,translate=(.03,.03),scale=(.95,1.05)),
        transforms.ColorJitter(.08,.08),
        transforms.ToTensor(),
        transforms.Normalize([.485,.456,.406],[.229,.224,.225])
    ])
    tva=transforms.Compose([
        transforms.Resize((args.image_size,args.image_size)),
        transforms.ToTensor(),
        transforms.Normalize([.485,.456,.406],[.229,.224,.225])
    ])

    train=DataLoader(DS(tr,root,ttr),batch_size=args.batch_size,shuffle=True,num_workers=args.workers,pin_memory=True,persistent_workers=args.workers>0,prefetch_factor=4)
    valid=DataLoader(DS(va,root,tva),batch_size=args.batch_size,shuffle=False,num_workers=args.workers,pin_memory=True,persistent_workers=args.workers>0,prefetch_factor=4)

    device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("Device:",device,torch.cuda.get_device_name(0) if device.type=="cuda" else "")
    if device.type!="cuda": raise SystemExit("CUDA required")

    model=models.convnext_tiny(weights=models.ConvNeXt_Tiny_Weights.DEFAULT)
    model.classifier[2]=nn.Linear(model.classifier[2].in_features,len(CLASSES))
    model=model.to(device,memory_format=torch.channels_last)

    loss_fn=nn.CrossEntropyLoss(label_smoothing=0.05)
    opt=torch.optim.AdamW(model.parameters(),lr=args.lr,weight_decay=1e-4)
    sched=torch.optim.lr_scheduler.ReduceLROnPlateau(opt,mode="max",factor=.5,patience=2,min_lr=1e-6)
    scaler=torch.amp.GradScaler("cuda")

    args.output.mkdir(parents=True,exist_ok=True)
    history=[]; best=-1.; bad=0; best_epoch=0
    for e in range(1,args.epochs+1):
        t=time.time(); tm=run_epoch(model,train,loss_fn,device,opt,scaler,f"train {e}/{args.epochs}")
        with torch.no_grad(): vm=run_epoch(model,valid,loss_fn,device,None,None,f"valid {e}/{args.epochs}")
        sched.step(vm["balanced_accuracy"])
        improved=vm["balanced_accuracy"]>best; bad=0 if improved else bad+1
        if improved: best=vm["balanced_accuracy"]; best_epoch=e
        rec={"epoch":e,"seconds":round(time.time()-t,2),"lr":opt.param_groups[0]["lr"],"seed":args.seed,"train":tm,"valid":vm}
        history.append(rec); (args.output/"history.json").write_text(json.dumps(history,indent=2),encoding="utf-8")
        ck={"epoch":e,"classes":CLASSES,"model":model.state_dict(),"optimizer":opt.state_dict(),"metrics":vm,"architecture":"convnext_tiny","image_size":args.image_size,"seed":args.seed}
        torch.save(ck,args.output/"last_checkpoint.pt")
        if improved:
            torch.save(ck,args.output/"best_checkpoint.pt")
            (args.output/"best_metrics.json").write_text(json.dumps(rec,indent=2),encoding="utf-8")
        print(f"Epoch {e}/{args.epochs}: train={tm['accuracy']:.4f} valid={vm['accuracy']:.4f} balanced={vm['balanced_accuracy']:.4f} macro_f1={vm['macro_f1']:.4f} lr={opt.param_groups[0]['lr']:.2e} best={best:.4f}@{best_epoch} no_improve={bad} time={rec['seconds']}s")
        if bad>=args.early_stop_patience:
            print(f"Early stopping after {bad} epochs without improvement."); break
    print(f"Best balanced accuracy: {best:.4f} at epoch {best_epoch}")
    print(f"Best checkpoint: {(args.output/'best_checkpoint.pt').resolve()}")

if __name__=="__main__": main()
