"""Freeze the reference runtime's Unicode/IDNA validity profile for native ports.

Source data: Python unicodedata (UCD 15.1), idna/idnadata (Unicode 17).
Re-run when intentionally upgrading the common email contract, with vector review.
"""
import json
import unicodedata
from pathlib import Path
from idna import idnadata
from idna.uts46data import uts46data
ROOT=Path(__file__).resolve().parents[1]

def ranges(predicate):
    result=[]
    start=None
    for point in range(0x110001):
        matched=point<0x110000 and predicate(chr(point))
        if matched and start is None:
            start=point
        elif not matched and start is not None:
            result.append([start,point])
            start=None
    return result

profile={
    'uts46': list(uts46data),
    'pvalid':[[value>>32,value&0xffffffff] for value in idnadata.codepoint_classes['PVALID']],
    'unsafe':ranges(lambda c: unicodedata.category(c)[0] in 'ZC'),
    'marks':ranges(lambda c: unicodedata.category(c)[0]=='M'),
    'bidi':{key:ranges(lambda c: unicodedata.bidirectional(c)==key) for key in ['R','AL','AN','EN','ES','CS','ET','ON','BN','NSM','L']}
}
data=json.dumps(profile,separators=(',',':'))
(ROOT/'src/app/auth/email-unicode.ts').write_text('// Generated from UCD '+unicodedata.unidata_version+' and IDNA '+idnadata.__version__+'.\n// prettier-ignore\nexport const EMAIL_UNICODE = '+json.dumps({key:value for key,value in profile.items() if key != 'uts46'},separators=(',',':'))+';\n', newline='\n')
