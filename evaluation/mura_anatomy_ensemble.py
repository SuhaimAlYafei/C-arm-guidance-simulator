from __future__ import annotations

import argparse, csv, json
from pathlib import Path

import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms
from tqdm import tqdm

CLASSES=["ELBOW","FINGER","FOREARM","HAND","HUMERUS","SHOULDER","WRIST"]
C2I={c:i for i,c in enumerate(CLASSES)}


def parse_rows(csv_path: Path):
    rows=[]
    with csv_path.open("r",encoding="utf-8-sig",newline="") as f:
        for r in csv.DictReader(f):
            p=r.get("file_name","").replace("\\","/").strip(); z=p.split("/")
            if len(z)<5 or z[0]!="valid": continue
            if Path(z[-1]).name.startswith("._") or "__MACOSX" in z: continue
            if not z[1].startswith("XR_"): continue
            a=z[1][3:].upper()
            if a in C2I: rows.append((p,a))
    return rows


def find_root(d: Path, probe: str):
    for b in [d/d.name,d/"images",d]:
        if (b/Path(probe)).is_file(): return b
    img=d/"images"
    if img.exists():
        for c in img.iterdir():
            if c.is_dir() and (c/Path(probe)).is_file(): return c
    raise FileNotFoundError("Could not locate MURA image root")


class DS(Dataset):
    def __init__(self,rows,root,tf): self.rows,self.root,self.tf=rows,root,tf
    def __len__(self): return len(self.rows)
    def __getitem__(self,i):
        rel,a=self.rows[i]
        with Image.open(self.root/Path(rel)) as im: x=self.tf(im.convert("RGB"))
        return x,C2I[a],rel


def load_model(path: Path, device):
    ck=torch.load(path,map_location=device)
    model=models.resnet18(weights=None)
    model.fc=nn.Linear(model.fc.in_features,len(CLASSES))
    model.load_state_dict(ck["model"])
    model=model.to(device)
    model.eval()
    return model,ck


def summarize(cm):
    n=len(CLASSES); total=sum(map(sum,cm)); correct=sum(cm[i][i] for i in range(n)); recalls=[]; f1s=[]; per={}
    for i,c in enumerate(CLASSES):
        tp=cm[i][i]; support=sum(cm[i]); predicted=sum(cm[r][i] for r in range(n)); rec=tp/support if support else 0.; prec=tp/predicted if predicted else 0.; f1=2*prec*rec/(prec+rec) if prec+rec else 0.
        recalls.append(rec); f1s.append(f1); per[c]={"support":support,"precision":round(prec,6),"recall":round(rec,6),"f1":round(f1,6)}
    return {"accuracy":round(correct/total,6),"balanced_accuracy":round(sum(recalls)/n,6),"macro_f1":round(sum(f1s)/n,6),"per_class":per,"confusion_matrix":{"labels":CLASSES,"matrix":cm}}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data-root",type=Path,required=True)
    ap.add_argument("--baseline",type=Path,default=Path("results/mura_anatomy_fast/best_checkpoint.pt"))
    ap.add_argument("--focal",type=Path,default=Path("results/mura_anatomy_focal/best_checkpoint.pt"))
    ap.add_argument("--alpha",type=float,default=0.5,help="Weight for baseline probabilities; focal gets 1-alpha")
    ap.add_argument("--batch-size",type=int,default=64)
    ap.add_argument("--workers",type=int,default=8)
    ap.add_argument("--output",type=Path,default=Path("results/mura_anatomy_ensemble"))
    args=ap.parse_args()
    if not 0<=args.alpha<=1: raise SystemExit("--alpha must be between 0 and 1")

    rows=parse_rows(args.data_root/"mura_v1_1.csv"); root=find_root(args.data_root,rows[0][0])
    tf=transforms.Compose([transforms.Resize((224,224)),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
    loader=DataLoader(DS(rows,root,tf),batch_size=args.batch_size,shuffle=False,num_workers=args.workers,pin_memory=True,persistent_workers=args.workers>0)
    device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    baseline,bck=load_model(args.baseline,device); focal,fck=load_model(args.focal,device)
    print(f"Baseline epoch={bck.get('epoch')} | Focal epoch={fck.get('epoch')} | alpha={args.alpha:.2f}")

    n=len(CLASSES); cm=[[0]*n for _ in range(n)]; records=[]; conf_sum=0.; corr_conf=0.; inc_conf=0.; nc=ni=0; disagree=0; ensemble_correct_when_disagree=0
    with torch.no_grad():
        for x,y,paths in tqdm(loader,desc="ensemble",dynamic_ncols=True):
            x=x.to(device,non_blocking=True); y=y.to(device,non_blocking=True)
            with torch.autocast(device_type="cuda",dtype=torch.float16,enabled=device.type=="cuda"):
                pb=torch.softmax(baseline(x).float(),dim=1); pf=torch.softmax(focal(x).float(),dim=1)
            pe=args.alpha*pb+(1-args.alpha)*pf; conf,pred=pe.max(1); pred_b=pb.argmax(1); pred_f=pf.argmax(1)
            for j in range(y.size(0)):
                a=int(y[j]); b=int(pred[j]); c=float(conf[j]); cm[a][b]+=1; conf_sum+=c; ok=a==b
                if ok: corr_conf+=c; nc+=1
                else: inc_conf+=c; ni+=1
                dg=int(pred_b[j])!=int(pred_f[j]); disagree+=int(dg); ensemble_correct_when_disagree+=int(dg and ok)
                records.append({"path":paths[j],"true":CLASSES[a],"baseline":CLASSES[int(pred_b[j])],"focal":CLASSES[int(pred_f[j])],"ensemble":CLASSES[b],"confidence":round(c,6),"correct":ok})

    summary=summarize(cm); total=len(rows)
    summary.update({"validation_images":total,"baseline_epoch":bck.get("epoch"),"focal_epoch":fck.get("epoch"),"alpha_baseline":args.alpha,"alpha_focal":1-args.alpha,"mean_confidence":round(conf_sum/total,6),"mean_confidence_correct":round(corr_conf/nc,6) if nc else None,"mean_confidence_incorrect":round(inc_conf/ni,6) if ni else None,"model_disagreement_count":disagree,"model_disagreement_pct":round(100*disagree/total,3),"ensemble_accuracy_when_models_disagree":round(ensemble_correct_when_disagree/disagree,6) if disagree else None,"note":"Development-set ensemble evaluation on the same patient-separated MURA validation split; not an untouched final test set and not clinical validation."})
    args.output.mkdir(parents=True,exist_ok=True); (args.output/"summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    with (args.output/"predictions.csv").open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=records[0].keys()); w.writeheader(); w.writerows(records)
    print(json.dumps(summary,indent=2)); print(f"Wrote {args.output/'summary.json'}")

if __name__=="__main__": main()
