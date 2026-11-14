"""Cree UN prospect synthetique par les mecanismes existants du moteur (Store.upsert + fp_lid_for).
Usage (depuis le depot du moteur) : DATABASE_URL=... python mint-synthetic-prospect.py <fichier de sortie du fp_lid>
Aucun jeton n'est insere a la main : le fp_lid est celui qu'AI Lab emettrait pour un vrai prospect."""
import os, sys
from src.store import Store
s = Store(os.environ['DATABASE_URL']); s.init()
p = {'source': 'certification', 'source_id': 'cert-synthetic-0001', 'segment': 'CLIENTS_FR_BE_SMB',
     'email': 'synthetic.prospect@example.test', 'company': 'FP-CERT Synthetic', 'domain': 'example.test', 'country': 'FR'}
with s.db.transaction():
    s.lock(); s.upsert(p)
pid = s.db.execute('select prospect_id from segments limit 1').fetchone()['prospect_id']
open(sys.argv[1], 'w').write(s.fp_lid_for(pid))
