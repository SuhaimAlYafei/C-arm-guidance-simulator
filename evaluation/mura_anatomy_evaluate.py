from __future__ import annotations

import argparse, csv, json
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
            p=r.get("file_name","").replace("\\","/").strip(); parts=p.split("/")
            if len(parts)<5 or parts[0]!="valid": continue
            if Path(parts[-1]).name.startswith("._") or "__MACOSX" in parts: continue
            if not parts[1].startswith("XR_"): continue
            a=parts[1][3:].upper()
            if a in C2I: rows.append((p,a))
    return rows


def find_root(data_root: Path, probe: str):
    for b in [data_root/data_root.name,data_root/"images",data_root]:
        if (b/Path(probe)).is_file(): return b
    img=data_root/"images"
    if img.exists():
        for child in img.iterdir():
            if child.is_dir() and (child/Path(probe)).is_file(): return child
    raise FileNotFoundError("Could not locate MURA image root")


class DS(Dataset):
    def __init__(self,rows,root,tf): self.rows,self.root,self.tf=rows,root,tf
    def __len__(self): return len(self.rows)
    def __getitem__(self,i):
        rel,a=self.rows[i]
        with Image.open(self.root/Path(rel)) as im: x=self.tf(im.convert("RGB"))
        return x,C2I[a],rel


def build_model(ck):
    arch=str(ck.get("architecture","resnet18")).lower()
    if arch=="convnext_tiny":
        model=models.convnext_tiny(weights=None)
        model.classifier[2]=nn.Linear(model.classifier[2].in_features,len(CLASSES))
    elif arch=="resnet50":
        model=models.resnet50(weights=None)
        model.fc=nn.Linear(model.fc.in_features,len(CLASSES))
    elif arch=="resnet18":
        model=models.resnet18(weights=None)
        model.fc=nn.Linear(model.fc.in_features,len(CLASSES))
    else:
        raise ValueError(f"Unsupported checkpoint architecture: {arch}")
    model.load_state_dict(ck["model"])
    return model,arch


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data-root",type=Path,required=True)
    ap.add_argument("--checkpoint",type=Path,default=Path("results/mura_anatomy_fast/best_checkpoint.pt"))
    ap.add_argument("--batch-size",type=int,default=64)
    ap.add_argument("--workers",type=int,default=8)
    ap.add_argument("--output",type=Path,default=Path("results/mura_anatomy_evaluation"))
    args=ap.parse_args()

    device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ck=torch.load(args.checkpoint,map_location=device)
    model,arch=build_model(ck)
    image_size=int(ck.get("image_size",224))

    rows=parse_rows(args.data_root/"mura_v1_1.csv"); root=find_root(args.data_root,rows[0][0])
    tf=transforms.Compose([transforms.Resize((image_size,image_size)),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
    loader=DataLoader(DS(rows,root,tf),batch_size=args.batch_size,shuffle=False,num_workers=args.workers,pin_memory=True,persistent_workers=args.workers>0)
    model=model.to(device,memory_format=torch.channels_last); model.eval()
    print(f"Checkpoint epoch={ck.get('epoch')} architecture={arch} image_size={image_size} device={device}")

    n=len(CLASSES); cm=[[0]*n for _ in range(n)]; records=[]; correct=0; total=0; conf_sum=0.; correct_conf=0.; incorrect_conf=0.; nc=0; ni=0
    with torch.no_grad():
        for x,y,paths in tqdm(loader,desc="evaluate",dynamic_ncols=True):
            x=x.to(device,non_blocking=True,memory_format=torch.channels_last); y=y.to(device,non_blocking=True)
            with torch.autocast(device_type="cuda",dtype=torch.float16,enabled=device.type=="cuda"): logits=model(x)
            probs=torch.softmax(logits.float(),dim=1); conf,pred=probs.max(1)
            for j in range(y.size(0)):
                a=int(y[j]); b=int(pred[j]); c=float(conf[j]); cm[a][b]+=1; total+=1; conf_sum+=c
                ok=a==b; correct+=int(ok)
                if ok: correct_conf+=c; nc+=1
                else: incorrect_conf+=c; ni+=1
                records.append({"path":paths[j],"true":CLASSES[a],"predicted":CLASSES[b],"confidence":round(c,6),"correct":ok})

    per={}; recalls=[]; f1s=[]
    for i,c in enumerate(CLASSES):
        tp=cm[i][i]; support=sum(cm[i]); predicted=sum(cm[r][i] for r in range(n)); rec=tp/support if support else 0.; prec=tp/predicted if predicted else 0.; f1=2*prec*rec/(prec+rec) if prec+rec else 0.
        recalls.append(rec); f1s.append(f1); per[c]={"support":support,"precision":round(prec,6),"recall":round(rec,6),"f1":round(f1,6)}
    summary={"checkpoint_epoch":ck.get("epoch"),"architecture":arch,"image_size":image_size,"validation_images":total,"accuracy":round(correct/total,6),"balanced_accuracy":round(sum(recalls)/n,6),"macro_f1":round(sum(f1s)/n,6),"mean_confidence":round(conf_sum/total,6),"mean_confidence_correct":round(correct_conf/nc,6) if nc else None,"mean_confidence_incorrect":round(incorrect_conf/ni,6) if ni else None,"per_class":per,"confusion_matrix":{"labels":CLASSES,"matrix":cm},"note":"MURA patient-separated validation evaluation; anatomy classification only. This is not clinical validation of C-arm positioning."}
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/"summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    with (args.output/"predictions.csv").open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=records[0].keys()); w.writeheader(); w.writerows(records)
    print(json.dumps(summary,indent=2)); print(f"Wrote {args.output/'summary.json'}"); print(f"Wrote {args.output/'predictions.csv'}")

if __name__=="__main__": main()
