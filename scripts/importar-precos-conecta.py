"""Gera as tabelas regionais usando PDFs oficiais locais e pdftotext -layout."""
import argparse,base64,hashlib,json,re,subprocess,tempfile,unicodedata
from pathlib import Path

def cents(value):return int(value.replace('.','').replace(',',''))
def norm(value):return re.sub('[^a-z0-9]+',' ',unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower()).strip()
def extract(pdf):
 with tempfile.TemporaryDirectory() as tmp:
  out=Path(tmp)/'table.txt';subprocess.run(['pdftotext','-layout',str(pdf),str(out)],check=True);text=out.read_text()
 region=int(re.search(r'Região (\d+)',text)[1]);process=re.search(r'Processo (\d+)',text)[1]
 kind='pos' if pdf.name.startswith('pos-') else 'tecnico' if pdf.name.startswith('tecnicos-') else 'semi' if 'semipresencial' in pdf.name else 'ead'
 expected={'ead':59,'semi':52,'pos':489,'tecnico':14}[kind];rows=[]
 for block in text.split('\n\n'):
  money=re.findall(r'R\$\s*([\d.]+,\d{2})',block)
  if len(money)!=2:continue
  lines=block.strip('\n').splitlines();first=next(line for line in lines if 'R$' in line);before=first.split('R$')[0];code=re.search(r'\b(E[A-Z]+_[A-Z0-9_]+)\b',before)
  if code:
   end=code.start();title=first[:end].strip();tail=before[code.end():];code=code[1]
  else:
   match=re.search(r'^(.*?)\s+(\d+)\s+(\d+)\s*$',before)
   if not match:raise ValueError('Colunas não reconhecidas: '+block)
   end=match.start(2);title=before[:end].strip();tail=before[end:];code=None
  # Linhas de continuação do nome ficam à esquerda da coluna de código/duração.
  for line in lines[lines.index(first)+1:]:
   if line.strip() and len(line)-len(line.lstrip())<end:title+=' '+line.strip()
  values=re.findall(r'\b\d+(?:,\d+)?\b',tail);months=None;installments=None
  if kind in ['pos','tecnico']:
   if len(values)>=2:months=int(values[-2]);installments=int(values[-1])
  elif len(values)>=2:months=int(values[-1])
  price,punctual=map(cents,money)
  if abs((price*9000+5000)//10000-punctual)>1:raise ValueError('Pontualidade inconsistente: '+title)
  rows.append(dict(code=code,name=title,price=price,punctual=punctual,months=months,installments=installments))
 if len(rows)!=expected:raise ValueError(f'{pdf.name}: {len(rows)} != {expected}')
 keys=[r['code'] or norm(r['name']) for r in rows]
 if len(keys)!=len(set(keys)):raise ValueError('Identificadores repetidos: '+pdf.name)
 return dict(kind=kind,region=region,process=process,year=2027,date='2026-11-25',file=pdf.name,sha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),rows=rows)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('directory');parser.add_argument('output');args=parser.parse_args()
 tables=[extract(p) for p in sorted(p for p in Path(args.directory).glob('*25-11-2026*.pdf') if '-regiao-3-' in p.name or '-regiao-6-' in p.name)]
 if len(tables)!=8:raise ValueError('São esperadas oito tabelas regionais.')
 Path(args.output).write_text(json.dumps({'version':1,'date':'2026-11-25','tables':tables},ensure_ascii=False,separators=(',',':'))+'\n')
 print([(t['kind'],t['region'],len(t['rows'])) for t in tables])
