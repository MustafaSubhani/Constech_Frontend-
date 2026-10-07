# Foundations takeoff

Khanna Villa, sheet 269-S-100. Quantities are read from the DWG. The PDF is only the background.

![Identified footings and raft](foundations-identified.png)

Coloured boxes are the footings, labelled with the schedule tag and the concrete volume in m³. The dashed outline is the raft.

## Bill comparison

Bill No. 2, Section C. Difference is ours minus the bill.

| Item | Unit | Bill | Ours | Difference | % | Note |
|---|---|---:|---:|---:|---:|---|
| Footing concrete | m³ | 67 | 67.22 | +0.22 | +0.3 | Schedule depth. CF3 uses 400 mm, the same as the other CF footings |
| Footing formwork | m² | 143 | 144.21 | +1.21 | +0.8 | Perimeter times schedule depth |
| Footing reinforcement | kg | 5,879 | 5,943.5 | +64.5 | +1.1 | Each schedule column measured both ways, inside a 75 mm cover. No bends, laps or starter bars |
| Raft concrete | m³ | 65 | 65.23 | +0.23 | +0.4 | Outer foundation outline around the raft note, including the side bays |
| Raft formwork | m² | 41 | 41.02 | +0.02 | 0.0 | Edge of that outline times thickness |
| Raft reinforcement | kg | 5,608 | 5,537.9 | −70.1 | −1.3 | Mesh note inside each raft. The bars run across the rectangle around the outline |
| Blinding, 50 mm | m³ | 46 | 45.99 | −0.01 | 0.0 | 50 mm under the slab on grade and under the raft. The raft is lower, so its bed is added to the slab blinding |

The thickness is not assumed. `269-S-001` says foundations, ground beams and ground slabs sit on a minimum of 50 mm grade C12/15 blinding, unless a drawing says otherwise. The footing pads are the schedule exception, 9.00 m³. The slab on grade is 600 m² and the raft beds are 140 m². The raft is a deeper excavation, so its blinding is added to the slab blinding: 37.0 m³ plus the pads is 45.99 m³.

## Rest of the structural bill

Storey height is the slab level on one plan minus the slab level on the plan below, minus the beam depth written on the upper plan. Roof beams are 800 mm and upper-roof beams are 600 mm, so those storeys are no longer the full floor-to-floor height.

| Item | Unit | Bill | Ours | Difference | % | Note |
|---|---|---:|---:|---:|---:|---|
| Slab on grade | m³ | 57 | 58.43 | +1.43 | +2.5 | Outline around each slab-on-grade note, raft area taken out |
| Slab on grade steel | kg | 3,076 | 2,995.9 | −80.1 | −2.6 | T10@200 middle mesh over that area. Laps on T10 are not priced: S-010 has not been read for T10 |
| Columns | m³ | 41 | 42.23 | +1.23 | +3.0 | The column mark on a floor, from that floor up to the next, stopping at the beam above |
| Column formwork | m² | 508 | 490.1 | −17.9 | −3.5 | Same columns, same height |
| Grade beams | m³ | 43 | 41.70 | −1.30 | −3.0 | Label size times the paired edges, taken to the column centre where the line stops short |
| Suspended slab sides and soffit | m² | 1,294 | 1,367.4 | +73.4 | +5.7 | Soffit of the outline, plus the free edges and the opening edges |
| Suspended slab steel | kg | 25,992 | 26,236.7 | +244.7 | +0.9 | T12@200 top and bottom, plus the extra marks that have a length and a distribution line |
| Suspended slabs | m³ | 323 | 290.53 | −32.47 | −10.1 | Openings taken out. Where 200 and 275 mm notes share one roof bay, the 275 mm note is used |
| Grade beam formwork | m² | 392 | 407.6 | +15.6 | +4.0 | Two sides plus the soffit. The section shows the beam bottom above the blinding, so the soffit is shuttered |
| Beams | m³ | 106 | 112.18 | +6.18 | +5.8 | Label width and full depth times the paired edges on the first floor, roof and upper roof |
| Beam sides and soffit | m² | 830 | 881.5 | +51.5 | +6.2 | Two sides plus the soffit of that section |
| Column necks | m³ | 9 | 11.74 | +2.74 | +30.4 | From the top of each footing to the ground beam next to that column. The −3.10 level is the bottom of the footing |
| Column neck formwork | m² | 122 | 135.7 | +13.7 | +11.2 | Perimeter of those columns times that height, about 2.49 m |
| Column neck steel | kg | 1,626 | 1,840 | +214 | +13.1 | Foundation-to-first-floor bars over that height, plus T10 stirrups at 200 mm |

The deeper mark −4.30 is used only for the column standing on it. Stair beams are on the stair-detail sheet and are not in the beam total. Shear and core walls are split from W2/W3 and W1 plan marks (S-202 is not in the drawing set, so heights follow storeys only). Tank walls use the annulus between the two hatch loops at the lift pit on S-100, times ground-to-first height. Lift pit walls use the smaller annulus; pit height comes from the section detail when a value under 2.5 m is written there, otherwise the full ground-storey height is used (that line can read high until pit levels are read from the detail). RC upstands are paired to the nearest slab edge. Beam/column schedule rebar is still not priced from S-200/S-201.

## Takeoff by tag

| Tag | Count | Concrete m³ | Blinding m³ | Formwork m² | Reinforcement kg |
|---|---:|---:|---:|---:|---:|
| F7 | 4 | 14.26 | 1.54 | 21.60 | 595.2 |
| FC1 | 38 | 13.73 | 2.62 | 50.25 | 793.2 |
| F6 | 4 | 9.86 | 1.34 | 16.00 | 530.8 |
| F5 | 4 | 7.68 | 1.05 | 14.08 | 339.2 |
| CF3 | 1 | 6.00 | — | 6.72 | — |
| F4 | 3 | 5.02 | 0.69 | 9.84 | 216.6 |
| CF2 | 1 | 3.12 | 0.42 | 4.72 | 139.1 |
| F1 | 4 | 2.16 | 0.42 | 6.48 | 101.2 |
| CF1 | 1 | 1.74 | 0.24 | 3.60 | 74.9 |
| F3 | 2 | 1.43 | 0.27 | 3.72 | 69.2 |
| F2 | 2 | 1.33 | 0.25 | 3.60 | 61.0 |
| FC2 | 3 | 0.90 | 0.17 | 3.60 | 49.8 |
| **Total** | **67** | **67.22** | **9.00** | **144.21** | **2,970.2** |

The 9.00 m³ column is the pads only. The bill line, 39.55 m³, is those pads plus the slab, the raft beds and the ground beams, each square metre once.

CF3 is on the drawing and in the concrete total. The schedule says “refer to plan” and gives no bar size for a known plan area, so its reinforcement is left out.

FC1 outlines on the drawing are the 1,100 × 1,250 blinding pad. The reinforced footing in the schedule is 1,000 × 1,200 × 300. Concrete for those uses the schedule size, 0.36 m³ each.

## Files

- [cross-project-eval.md](cross-project-eval.md) — Khanna DD vs 2099 tower generalisation check
- `foundations-identified.png`
- `269-S-100-FOUNDATIONS-overlay.pdf`
- `269-S-100-FOUNDATIONS-foundations.csv`
- `foundations-compare.csv`
