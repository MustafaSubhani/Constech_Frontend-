/* Sample projects so the screens can be reviewed before the API is connected.
   The backend replaces this file's data with the payloads described in api.js. */
(function () {
  const FRAME = [150, 100, 960, 600];

  function rect(x, y, w, h) {
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
  }

  function band(x1, y1, x2, y2, width) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * (width / 2);
    const py = (dx / len) * (width / 2);
    return [
      [x1 + px, y1 + py],
      [x2 + px, y2 + py],
      [x2 - px, y2 - py],
      [x1 - px, y1 - py],
    ];
  }

  function column(id, x, y, tag, area) {
    const s = 30;
    return {
      id,
      kind: "column",
      label: tag + "  " + area + " m²",
      points: rect(x, y, s, s),
    };
  }

  function frameGuides() {
    const [x0, y0, x1, y1] = FRAME;
    return [
      [x0, y0, x1, y0],
      [x1, y0, x1, y1],
      [x1, y1, x0, y1],
      [x0, y1, x0, y0],
      [x0, 270, x1, 270],
      [x0, 450, x1, 450],
      [390, y0, 390, y1],
      [700, y0, 700, y1],
    ];
  }

  const slab = [
    [190, 140],
    [920, 140],
    [920, 270],
    [860, 270],
    [860, 450],
    [920, 450],
    [920, 560],
    [190, 560],
  ];

  function floorSheet(opts) {
    const shapes = [
      {
        id: opts.id + "-slab",
        kind: "slab",
        label: opts.slabLabel,
        points: slab,
      },
    ];
    opts.columns.forEach(function (c, i) {
      shapes.push(column(opts.id + "-c" + i, c[0], c[1], c[2], c[3]));
    });
    (opts.walls || []).forEach(function (w) {
      shapes.push({
        id: opts.id + "-" + w.id,
        kind: "wall",
        label: w.label,
        points: rect(w.x, w.y, w.w, w.h),
      });
    });
    opts.beams.forEach(function (b, i) {
      shapes.push({
        id: opts.id + "-b" + i,
        kind: "beam",
        label: b.label,
        points: band(b.x1, b.y1, b.x2, b.y2, b.w || 16),
      });
    });
    return {
      id: opts.id,
      code: opts.code,
      title: opts.title,
      role: opts.role,
      floor: opts.floor,
      signals: opts.signals,
      width: 1100,
      height: 760,
      frame: FRAME,
      guides: frameGuides(),
      openings: opts.openings || [],
      shapes: shapes,
    };
  }

  const groundColumns = [
    [210, 168, "C1", "0.16"],
    [430, 168, "C2", "0.20"],
    [730, 168, "C1", "0.16"],
    [880, 168, "C3", "0.25"],
    [210, 360, "C2", "0.20"],
    [560, 360, "C4", "0.36"],
    [880, 360, "C1", "0.16"],
    [210, 510, "C3", "0.25"],
    [730, 510, "C2", "0.20"],
  ];

  const ground = floorSheet({
    id: "s101",
    code: "S-101-A",
    title: "Ground floor framing",
    role: "Framing plan",
    floor: "Ground",
    signals: ["Slab thickness notes", "Sized beam labels", "Wall marks", "SSL levels"],
    openings: [[730, 300, 120, 110]],
    slabLabel: "Slab on grade  150 mm  ·  186 m²",
    columns: groundColumns,
    walls: [
      { id: "w1", x: 560, y: 300, w: 150, h: 130, label: "W1 core  ·  4.20 m²" },
      { id: "w2", x: 188, y: 200, w: 26, h: 240, label: "W2  ·  2.40 m²" },
    ],
    beams: [
      { x1: 240, y1: 183, x2: 860, y2: 183, label: "GB1  250×400" },
      { x1: 225, y1: 200, x2: 225, y2: 520, label: "GB2  250×500" },
      { x1: 250, y1: 375, x2: 540, y2: 375, label: "GB3  200×400" },
      { x1: 250, y1: 525, x2: 700, y2: 525, label: "B  200×550" },
    ],
  });

  const first = floorSheet({
    id: "s102",
    code: "S-102",
    title: "First floor framing",
    role: "Framing plan",
    floor: "First",
    signals: ["Slab thickness notes", "Sized beam labels", "SSL levels"],
    openings: [[730, 300, 120, 110]],
    slabLabel: "Suspended slab  200 mm  ·  164 m²",
    columns: groundColumns.slice(0, 7),
    walls: [{ id: "w1", x: 560, y: 300, w: 150, h: 130, label: "W1 core  ·  4.20 m²" }],
    beams: [
      { x1: 240, y1: 183, x2: 860, y2: 183, label: "FB1  200×500" },
      { x1: 225, y1: 210, x2: 225, y2: 500, label: "FB2  200×500" },
      { x1: 260, y1: 375, x2: 540, y2: 375, label: "RB1  200×400" },
    ],
  });

  const roof = floorSheet({
    id: "s103",
    code: "S-103",
    title: "Roof framing",
    role: "Framing plan",
    floor: "Roof",
    signals: ["Slab thickness notes", "Sized beam labels", "SSL levels"],
    openings: [],
    slabLabel: "Suspended slab  150 mm  ·  158 m²",
    columns: groundColumns.filter(function (_, i) {
      return i % 2 === 0;
    }),
    walls: [],
    beams: [
      { x1: 240, y1: 183, x2: 860, y2: 183, label: "RB1  200×400" },
      { x1: 250, y1: 525, x2: 820, y2: 525, label: "URB1  200×300" },
    ],
  });

  const foundation = {
    id: "s100",
    code: "S-100",
    title: "Foundation layout",
    role: "Foundation plan",
    floor: "Foundation",
    signals: ["Footing schedule", "Raft thickness", "Lift pit note"],
    width: 1100,
    height: 760,
    frame: FRAME,
    guides: frameGuides(),
    openings: [],
    shapes: [
      {
        id: "raft",
        kind: "raft",
        label: "Raft  500 mm  ·  86.4 m³",
        dashed: true,
        points: [
          [240, 190],
          [760, 190],
          [760, 310],
          [860, 310],
          [860, 520],
          [240, 520],
        ],
      },
      { id: "f1", kind: "footing", label: "F1  ·  2.59 m³", points: rect(145, 95, 100, 88) },
      { id: "f2", kind: "footing", label: "F2  ·  3.24 m³", points: rect(855, 95, 110, 96) },
      { id: "f3", kind: "footing", label: "F1  ·  2.59 m³", points: rect(145, 512, 100, 88) },
      { id: "f4", kind: "footing", label: "F2  ·  3.24 m³", points: rect(855, 508, 110, 96) },
      { id: "f5", kind: "footing", label: "F3  ·  1.84 m³", points: rect(470, 92, 92, 80) },
      { id: "f6", kind: "footing", label: "F3  ·  1.84 m³", points: rect(470, 518, 92, 80) },
      { id: "cf1", kind: "footing", label: "CF1  ·  4.10 m³", points: rect(270, 300, 140, 120) },
      {
        id: "missed",
        kind: "missed",
        label: "Missed  ·  not in the total",
        dashed: true,
        points: rect(740, 500, 100, 78),
      },
    ],
  };

  function infoSheet(id, code, title, role, signals) {
    return {
      id: id,
      code: code,
      title: title,
      role: role,
      floor: "",
      signals: signals,
      width: 1100,
      height: 760,
      frame: null,
      guides: [],
      openings: [],
      shapes: [],
    };
  }

  const barshaSheets = [
    foundation,
    ground,
    infoSheet("s101b", "S-101-B", "Ground floor reinforcement", "Reinforcement plan", [
      "Mesh notes",
      "Additional bar marks",
    ]),
    first,
    roof,
    infoSheet("s010", "S-010", "General notes", "General notes", ["Blinding note", "Cover note"]),
    infoSheet("s201", "S-201", "Column schedule", "Column schedule", ["Column marks"]),
    infoSheet("s300", "S-300", "Sections", "Section", ["Lift pit section"]),
  ];

  const comparison = [
    ["Foundations", "Footing concrete", "m³", 2, 48.6, 47.15, "Schedule depth times the matching outline."],
    ["Foundations", "Footing formwork", "m²", 2, 186.4, 191.2, "Perimeter times the schedule depth."],
    ["Foundations", "Footing reinforcement", "kg", 0, 4280, 3510, "Bars inside the cover. Bends, laps, and starters are not included yet."],
    ["Foundations", "Raft concrete", "m³", 2, 92.3, 90.84, "Closed outline around each raft thickness note."],
    ["Foundations", "Raft formwork", "m²", 2, 28.5, 27.1, "Edge length of that outline times the thickness."],
    ["Foundations", "Raft reinforcement", "kg", 0, 6120, 5840, "Mesh written inside the raft, both ways. Edge bars are not included."],
    ["Foundations", "Blinding", "m³", 2, 21.8, 22.46, "50 mm from the general notes, under the slab on grade, the raft beds, and the footing pads."],
    ["Frame", "Slab on grade", "m³", 2, 36.2, 35.4, "Outline around the slab-on-grade note, with the raft footprint removed."],
    ["Frame", "Slab on grade steel", "kg", 0, 1840, 1795, "Mesh note on the ground floor reinforcement plan."],
    ["Frame", "Columns", "m³", 2, 24.8, 23.15, "Plan area of the column marks times the storey height, stopping under the beam above."],
    ["Frame", "Column formwork", "m²", 2, 310, 292.4, "Column perimeter times that height."],
    ["Frame", "Grade beams", "m³", 2, 18.6, 17.95, "Label size times the paired edges, extended to the column centre."],
    ["Frame", "Grade beam formwork", "m²", 2, 142, 138.2, "Two sides plus the soffit."],
    ["Frame", "Suspended slabs", "m³", 2, 71.4, 60.1, "Outline around each thickness note, less openings and less any slab inside it."],
    ["Frame", "Suspended slab formwork", "m²", 2, 690, 648.5, "Soffit, plus free edges and opening edges times the thickness."],
    ["Frame", "Suspended slab steel", "kg", 0, 8450, 9120, "Mesh over each slab. A lap is added where a bar is longer than 12 m."],
    ["Frame", "Beams", "m³", 2, 29.7, 34.8, "Label width and depth times the paired edges on the upper floors."],
    ["Frame", "Beam formwork", "m²", 2, 248, 261.3, "Sides and soffit of that section."],
    ["Frame", "Column necks", "m³", 2, 6.4, 6.15, "From the top of each footing to the underside of the ground beam."],
    ["Frame", "Column neck formwork", "m²", 2, 78, 74.8, "Column perimeter times that height."],
    ["Frame", "Column neck steel", "kg", 0, 420, 390, "Vertical bars over that height, plus T10 stirrups at 200 mm."],
    ["Walls", "Shear walls", "m³", 2, 16.8, 16.1, "W2 and W3 outlines times the storey height above that floor."],
    ["Walls", "Core walls", "m³", 2, 11.2, 9.4, "W1 outlines times the storey height above that floor."],
    ["Walls", "Lift pit walls", "m³", 2, 4.6, 4.35, "Smaller hatch annulus at the lift pit note."],
    ["Walls", "Tank walls", "m³", 2, 7.1, 6.2, "Larger hatch annulus times the ground-to-first-floor height."],
    ["Walls", "Upstands", "m³", 2, 2.8, 2.65, "Upstand labels paired to the nearest long slab edge."],
  ].map(function (row, index) {
    return {
      id: "c" + index,
      section: row[0],
      label: row[1],
      unit: row[2],
      digits: row[3],
      bill: row[4],
      ours: row[5],
      note: row[6],
    };
  });

  window.BOQ_DATA = {
    projects: [
      {
        id: "barsha",
        name: "Al Barsha Residence",
        place: "Al Barsha 1, Dubai",
        bill: "Section C — Concrete.xlsx",
        updated: "2 Oct 2026",
        sample: true,
        runs: { discover: true, foundations: true, structure: true },
        capabilities: [
          { id: "Footings", status: "ready", reason: "Footing schedule found on S-100." },
          { id: "Rafts", status: "ready", reason: "Raft thickness notes sit inside a closed outline." },
          { id: "Blinding", status: "ready", reason: "50 mm blinding note in the general notes." },
          { id: "Storey heights", status: "ready", reason: "SSL spot levels on the floor plans." },
          { id: "Slabs", status: "ready", reason: "Slab thickness notes and closed slab outlines." },
          { id: "Beams", status: "ready", reason: "Beam labels include the section size." },
          { id: "Walls", status: "ready", reason: "Wall marks on the plans." },
        ],
        sheets: barshaSheets,
        comparison: comparison,
      },
      {
        id: "jvc",
        name: "JVC Townhouses",
        place: "Jumeirah Village Circle, Dubai",
        bill: "",
        updated: "Not measured",
        sample: false,
        runs: { discover: true, foundations: false, structure: false },
        capabilities: [
          { id: "Pile caps", status: "partial", reason: "A pile cap schedule is on the sheet. Quantity rules are not in place yet." },
          { id: "Storey heights", status: "partial", reason: "Level text is present, but not as SSL marks." },
          { id: "Slabs", status: "blocked", reason: "Plan sheets have no slab thickness notes." },
          { id: "Beams", status: "partial", reason: "Beam marks are on the plans without a section size." },
        ],
        sheets: [
          infoSheet("j1", "S-001", "Foundation layout", "Foundation layout", ["Pile cap schedule"]),
          infoSheet("j2", "S-101", "Ground floor plan", "Floor plan", ["Level marks"]),
          infoSheet("j3", "S-102", "First floor plan", "Floor plan", ["Beam marks"]),
          infoSheet("j4", "S-201", "General notes", "General notes", []),
        ],
        comparison: [],
      },
    ],
  };
})();
