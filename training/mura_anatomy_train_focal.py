from __future__ import annotations

# Controlled follow-up experiment for the MURA anatomy classifier.
# Uses the same patient-separated train/validation split as the baseline,
# but applies inverse-frequency class weighting plus focal loss.

import argparse, csv, json, random, time
from pathlib import Path
import torch
import torch.nn as nn
import torch.nn.functional as F
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
    for b in [d/d.name,d/"images",d]:
        if (b/Path(probe)).is_file(): return b
    for c in (d/"images").iterdir():
        if c.is_dir() and (c/Path(probe)).is_file(): return c
    raise FileNotFoundError("MURA image root not found")

class DS(Dataset):
    def __init__(self,r,root,tf): self.r,self.root,self.tf=r,root,tf
    def __len__(self): return len(self.r)
    def __getitem__(self,i):
        p,_,a=self.r[i]
        with Image.open(self.root/Path(p)) as im: x=self.tf(im.convert("RGB"))
        return x,C2I[a]

class FocalLoss(nn.Module):
    def __init__(self,weight=None,gamma=1.5): super().__init__(); self.register_buffer("weight",weight); self.gamma=gamma
    def forward(self,x,y):
        ce=F.cross_entropy(x,y,weight=self.weight,reduction="none")
        pt=torch.exp(-F.cross_entropy(x,y,reduction="none"))
        return (((1-pt)**self.gamma)*ce).mean()

def calc(pred,y):
    n=len(CLASSES); cm=[[0]*n for _ in range(n)]
    for a,b in zip(y,pred): cm[a][b]+=1
    rec=[]; correct=0; total=0
    for i in range(n):
        s=sum(cm[i]); rec.append(cm[i][i]/s if s else 0); correct+=cm[i][i]; total+=s
    return correct/total,sum(rec)/n,cm

def epoch(model,loader,loss_fn,dev,opt=None,scaler=None,desc=""):
    train=opt is not None; model.train(train); ps=[]; ys=[]; loss_sum=0
    for x,y in tqdm(loader,desc=desc,dynamic_ncols=True):
        x=x.to(dev,non_blocking=True,memory_format=torch.channels_last); y=y.to(dev,non_blocking=True)
        if train: opt.zero_grad(set_to_none=True)
        with torch.autocast(device_type="cuda",dtype=torch.float16): out=model(x); loss=loss_fn(out,y)
        if train: scaler.scale(loss).backward(); scaler.step(opt); scaler.update()
        loss_sum+=loss.item()*y.size(0); ps.extend(out.argmax(1).detach().cpu().tolist()); ys.extend(y.cpu().tolist())
    acc,bal,cm=calc(ps,ys); return {"loss":loss_sum/len(loader.dataset),"accuracy":acc,"balanced_accuracy":bal,"confusion_matrix":cm}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--data-root",type=Path,required=True); ap.add_argument("--epochs",type=int,default=30); ap.add_argument("--batch-size",type=int,default=64); ap.add_argument("--workers",type=int,default=8); ap.add_argument("--lr",type=float,default=1e-4); ap.add_argument("--gamma",type=float,default=1.5); ap.add_argument("--output",type=Path,default=Path("results/mura_anatomy_focal")); args=ap.parse_args()
    random.seed(23112); torch.manual_seed(23112); torch.backends.cudnn.benchmark=True
    rows=parse_rows(args.data_root/"mura_v1_1.csv"); root=find_root(args.data_root,rows[0][0]); tr=[r for r in rows if r[1]=="train"]; va=[r for r in rows if r[1]=="valid"]
    counts=[sum(1 for r in tr if C2I[r[2]]==i) for i in range(len(CLASSES))]
    # sqrt inverse frequency is deliberately milder than full inverse-frequency weighting.
    mean=sum(counts)/len(counts); weights=torch.tensor([(mean/c)**0.5 for c in counts],dtype=torch.float32); weights/=weights.mean()
    print("Train counts:",dict(zip(CLASSES,counts))); print("Class weights:",dict(zip(CLASSES,[round(float(x),3) for x in weights])))
    ttr=transforms.Compose([transforms.Resize((224,224)),transforms.RandomRotation(5),transforms.RandomAffine(0,translate=(.03,.03),scale=(.95,1.05)),transforms.ColorJitter(.08,.08),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])]); tva=transforms.Compose([transforms.Resize((224,224)),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
    dl=lambda d,sh: DataLoader(d,batch_size=args.batch_size,shuffle=sh,num_workers=args.workers,pin_memory=True,persistent_workers=args.workers>0,prefetch_factor=4)
    train=dl(DS(tr,root,ttr),True); valid=dl(DS(va,root,tva),False); dev=torch.device("cuda" if torch.cuda.is_available() else "cpu"); print("Device:",dev,torch.cuda.get_device_name(0) if dev.type=="cuda" else "");
    if dev.type!="cuda": raise SystemExit("CUDA required")
    model=models.resnet18(weights=models.ResNet18_Weights.DEFAULT); model.fc=nn.Linear(model.fc.in_features,len(CLASSES)); model=model.to(dev,memory_format=torch.channels_last)
    loss_fn=FocalLoss(weights.to(dev),args.gamma); opt=torch.optim.AdamW(model.parameters(),lr=args.lr,weight_decay=1e-4); sched=torch.optim.lr_scheduler.ReduceLROnPlateau(opt,mode="max",factor=.5,patience=3,min_lr=1e-6); scaler=torch.amp.GradScaler("cuda"); args.output.mkdir(parents=True,exist_ok=True)
    best=-1; bad=0; history=[]
    for e in range(1,args.epochs+1):
        t=time.time(); tm=epoch(model,train,loss_fn,dev,opt,scaler,f"train {e}/{args.epochs}");
        with torch.no_grad(): vm=epoch(model,valid,loss_fn,dev,None,None,f"valid {e}/{args.epochs}")
        sched.step(vm["balanced_accuracy"]); improved=vm["balanced_accuracy"]>best; bad=0 if improved else bad+1
        if improved: best=vm["balanced_accuracy"]
        rec={"epoch":e,"seconds":round(time.time()-t,2),"lr":opt.param_groups[0]["lr"],"train":tm,"valid":vm}; history.append(rec); (args.output/"history.json").write_text(json.dumps(history,indent=2))
        ck={"epoch":e,"classes":CLASSES,"model":model.state_dict(),"optimizer":opt.state_dict(),"metrics":vm,"loss":"weighted_focal","gamma":args.gamma,"class_weights":weights.tolist()}; torch.save(ck,args.output/"last_checkpoint.pt")
        if improved: torch.save(ck,args.output/"best_checkpoint.pt"); (args.output/"best_metrics.json").write_text(json.dumps(rec,indent=2))
        print(f"Epoch {e}/{args.epochs}: train={tm['accuracy']:.4f} valid={vm['accuracy']:.4f} balanced={vm['balanced_accuracy']:.4f} lr={opt.param_groups[0]['lr']:.2e} best={best:.4f} no_improve={bad} time={rec['seconds']}s")
        if bad>=10: print("Early stopping after 10 epochs without balanced-accuracy improvement."); break
    print(f"Best balanced accuracy: {best:.4f}")

if __name__=="__main__": main()
