"""Plan geometry in drawing millimetres."""


def shoelace(vertices):
    area = 0.0
    for i, (x1, y1) in enumerate(vertices):
        x2, y2 = vertices[(i + 1) % len(vertices)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def perimeter(vertices):
    length = 0.0
    for i, (x1, y1) in enumerate(vertices):
        x2, y2 = vertices[(i + 1) % len(vertices)]
        length += ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
    return length


def bbox(vertices):
    xs = [p[0] for p in vertices]
    ys = [p[1] for p in vertices]
    return min(xs), min(ys), max(xs), max(ys)


def bbox_size(vertices):
    x0, y0, x1, y1 = bbox(vertices)
    return x1 - x0, y1 - y0


def centroid(vertices):
    x0, y0, x1, y1 = bbox(vertices)
    return (x0 + x1) / 2.0, (y0 + y1) / 2.0


def point_in_poly(x, y, vertices):
    inside = False
    n = len(vertices)
    for i in range(n):
        x1, y1 = vertices[i]
        x2, y2 = vertices[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xinter = (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1
            if x < xinter:
                inside = not inside
    return inside


def sizes_match(w, h, a, b, tol=40):
    """True when a rectangle matches a x b in either orientation."""
    return (abs(w - a) <= tol and abs(h - b) <= tol) or (abs(w - b) <= tol and abs(h - a) <= tol)
