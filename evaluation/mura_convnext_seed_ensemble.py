from __future__ import annotations
import argparse,csv,json
from pathlib import Path
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import Dataset,DataLoader
from torchvision import models,transforms
from tqdm import tqdm

CLASSES=["ELBOW","FINGER","FOREARM","HAND","HUMERUS","SHOULDER","WRIST"]; C2I={c:i for i,c in enumerate(CLASSES)}

def rows(csv_path):
    out=[]
    with csv_path.open("r",encoding="utf-8-sig",newline="") as f:
        for r in csv.DictReader(f):
            p=r.get("file_name","").replace("\\","/").strip(); z=p.split("/")
            if len(z)<5 or z[0]!="valid" or Path(z[-1]).name.startswith("._") or "__MACOSX" in z or not z[1].startswith("XR_"): continue
            a=z[1][3:].upper()
            if a in C2I: out.append((p,a))
    return out

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
        p,a=self.r[i]
        with Image.open(self.root/Path(p)) as im: x=self.tf(im.convert("RGB"))
        return x,C2I[a],p

def load_ckpt(path,device):
    ck=torch.load(path,map_location=device); arch=ck.get("architecture"); size=int(ck.get("image_size",224))
    if arch!="convnext_tiny": raise ValueError(f"Expected convnext_tiny, got {arch}")
    m=models.convnext_tiny(weights=None); m.classifier[2]=nn.Linear(m.classifier[2].in_features,len(CLASSES)); m.load_state_dict(ck["model"]); m=m.to(device).eval()
    return m,ck,size

def summarize(cm):
    n=len(CLASSES); total=sum(map(sum,cm)); correct=sum(cm[i][i] for i in range(n)); recs=[]; f1s=[]; per={}
    for i,c in enumerate(CLASSES):
        tp=cm[i][i]; sup=sum(cm[i]); pred=sum(cm[r][i] for r in range(n)); rec=tp/sup if sup else 0.; prec=tp/pred if pred else 0.; f1=2*prec*rec/(prec+rec) if prec+rec else 0.; recs.append(rec); f1s.append(f1); per[c]={"support":sup,"precision":round(prec,6),"recall":round(rec,6),"f1":round(f1,6)}
    return {"accuracy":round(correct/total,6),"balanced_accuracy":round(sum(recs)/n,6),"macro_f1":round(sum(f1s)/n,6),"per_class":per,"confusion_matrix":{"labels":CLASSES,"matrix":cm}}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--data-root",type=Path,required=True); ap.add_argument("--checkpoint",type=Path,action="append",required=True,help="Repeat 3 times"); ap.add_argument("--batch-size",type=int,default=64); ap.add_argument("--workers",type=int,default=8); ap.add_argument("--output",type=Path,default=Path("results/mura_convnext_seed_ensemble")); args=ap.parse_args()
    if len(args.checkpoint)<2: raise SystemExit("Provide at least 2 --checkpoint arguments")
    device=torch.device("cuda" if torch.cuda.is_available() else "cpu"); loaded=[load_ckpt(p,device) for p in args.checkpoint]; sizes={s for _,_,s in loaded}
    if len(sizes)!=1: raise SystemExit(f"Checkpoint image sizes differ: {sizes}")
    size=sizes.pop(); rr=rows(args.data_root/"mura_v1_1.csv"); root=find_root(args.data_root,rr[0][0]); tf=transforms.Compose([transforms.Resize((size,size)),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])]); loader=DataLoader(DS(rr,root,tf),batch_size=args.batch_size,shuffle=False,num_workers=args.workers,pin_memory=True,persistent_workers=args.workers>0)
    models_=[x[0] for x in loaded]; cks=[x[1] for x in loaded]; n=len(CLASSES); cm=[[0]*n for _ in range(n)]; conf_sum=corr_conf=inc_conf=0.; nc=ni=0; records=[]; all_agree=0
    print("Ensembling:",[(ck.get("seed"),ck.get("epoch")) for ck in cks],"size=",size,"device=",device)
    with torch.no_grad():
        for x,y,paths in tqdm(loader,desc="seed ensemble",dynamic_ncols=True):
            x=x.to(device,non_blocking=True); y=y.to(device,non_blocking=True)
            probs=[]
            with torch.autocast(device_type="cuda",dtype=torch.float16,enabled=device.type=="cuda"):
                for m in models_: probs.append(torch.softmax(m(x).float(),dim=1))
            pe=torch.stack(probs).mean(0); conf,pred=pe.max(1); indiv=[p.argmax(1) for p in probs]
            for j in range(y.size(0)):
                a=int(y[j]); b=int(pred[j]); c=float(conf[j]); ok=a==b; cm[a][b]+=1; conf_sum+=c
                if ok: corr_conf+=c; nc+=1
                else: inc_conf+=c; ni+=1
                agree=len({int(q[j]) for q in indiv})==1; all_agree+=int(agree)
                records.append({"path":paths[j],"true":CLASSES[a],"ensemble":CLASSES[b],"confidence":round(c,6),"correct":ok,"all_models_agree":agree,**{f"model_{k+1}":CLASSES[int(indiv[k][j])] for k in range(len(indiv))}})
    s=summarize(cm); total=len(rr); s.update({"validation_images":total,"checkpoints":[{"seed":ck.get("seed"),"epoch":ck.get("epoch"),"architecture":ck.get("architecture"),"image_size":ck.get("image_size")} for ck in cks],"mean_confidence":round(conf_sum/total,6),"mean_confidence_correct":round(corr_conf/nc,6),"mean_confidence_incorrect":round(inc_conf/ni,6),"all_models_agree_pct":round(100*all_agree/total,3),"note":"Development-set equal-weight probability ensemble across independent training seeds on the same patient-separated MURA validation split; not an untouched final test set and not clinical validation."})
    args.output.mkdir(parents=True,exist_ok=True); (args.output/"summary.json").write_text(json.dumps(s,indent=2),encoding="utf-8")
    with (args.output/"predictions.csv").open("w",newline="",encoding="utf-8") as f: w=csv.DictWriter(f,fieldnames=records[0].keys()); w.writeheader(); w.writerows(records)
    print(json.dumps(s,indent=2)); print(f"Wrote {args.output/'summary.json'}")
if __name__=="__main__": main()
