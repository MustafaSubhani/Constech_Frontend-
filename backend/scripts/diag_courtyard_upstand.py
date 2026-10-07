import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
path = r"D:\Constech\work\khanna-villa-dd\Quantity Takeoff - structural- Khanna Courtyard-R01 (1).xlsx"
z = zipfile.ZipFile(path)
shared = []
root = ET.fromstring(z.read("xl/sharedStrings.xml"))
for si in root.findall("m:si", NS):
    shared.append("".join(t.text or "" for t in si.findall(".//m:t", NS)))
rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
rid = {rel.attrib.get("Id"): rel.attrib.get("Target") for rel in rels}
wb = ET.fromstring(z.read("xl/workbook.xml"))
for sh in wb.findall("m:sheets/m:sheet", NS):
    name = sh.attrib.get("name")
    rel_id = sh.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
    target = "xl/" + rid[rel_id].lstrip("/")
    sheet = ET.fromstring(z.read(target))
    rows = defaultdict(dict)
    for cell in sheet.findall(".//m:c", NS):
        ref = cell.attrib.get("r")
        if not ref:
            continue
        col = "".join(ch for ch in ref if ch.isalpha())
        row = int("".join(ch for ch in ref if ch.isdigit()))
        kind = cell.attrib.get("t")
        value = cell.find("m:v", NS)
        if kind == "s" and value is not None:
            rows[row][col] = shared[int(value.text)]
        elif value is not None:
            rows[row][col] = value.text
    for row in sorted(rows):
        desc = str(rows[row].get("B") or "")
        if "upstand" in desc.lower() or "UPSTAND" in desc:
            print(name, row, desc, rows[row])
