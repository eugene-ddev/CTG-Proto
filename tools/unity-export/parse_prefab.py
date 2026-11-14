import re, sys, json, math, glob, os
PROPS = {'c5f7cb52024140a6bfc0b6ee132f652f': ('cube', 'ce82545c3a00ee34494c179a0da89076'), '36de4ac796174b4d957ff54e3cfc3dbb': ('triangle', '26176efe0c2871b42a9e7d4afd5bdec9')}
DOC = re.compile(r'^--- !u!(\d+) &(-?\d+)( stripped)?\s*$', re.M)
def docs(text):
    ms = list(DOC.finditer(text))
    for i, m in enumerate(ms):
        end = ms[i+1].start() if i+1 < len(ms) else len(text)
        yield int(m.group(1)), m.group(2), bool(m.group(3)), text[m.end():end]
def vec(body, key):
    m = re.search(key + r': \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+)(?:, w: ([-\d.eE]+))?\}', body)
    return [float(v) for v in m.groups() if v is not None] if m else None
def ref(body, key):
    m = re.search(key + r': \{fileID: (-?\d+)(?:, guid: ([0-9a-f]+))?', body)
    return (m.group(1), m.group(2)) if m else (None, None)
def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw*bx+ax*bw+ay*bz-az*by, aw*by-ax*bz+ay*bw+az*bx, aw*bz+ax*by-ay*bx+az*bw, aw*bw-ax*bx-ay*by-az*bz]
def qrot(q, v):
    x, y, z, w = q; vx, vy, vz = v
    tx = 2*(y*vz - z*vy); ty = 2*(z*vx - x*vz); tz = 2*(x*vy - y*vx)
    return [vx + w*tx + y*tz - z*ty, vy + w*ty + z*tx - x*tz, vz + w*tz + x*ty - y*tx]
def euler(q):  # Unity ZXY order -> degrees
    x, y, z, w = q
    sinx = 2*(w*x - y*z); sinx = max(-1, min(1, sinx))
    ex = math.degrees(math.asin(sinx))
    ey = math.degrees(math.atan2(2*(w*y + x*z), 1 - 2*(x*x + y*y)))
    ez = math.degrees(math.atan2(2*(w*z + x*y), 1 - 2*(x*x + z*z)))
    return [round(ex, 1), round(ey, 1), round(ez, 1)]
def parse(path):
    t = open(path, encoding='utf-8').read()
    gos, trs, mf, mr, comps = {}, {}, {}, {}, {}
    for cls, fid, stripped, body in docs(t):
        if cls == 1:
            gos[fid] = re.search(r'm_Name: ?(.*)', body).group(1).strip()
        elif cls == 4:
            go = ref(body, 'm_GameObject')[0]
            trs[fid] = dict(go=go, pos=vec(body, 'm_LocalPosition'), rot=vec(body, 'm_LocalRotation'), scl=vec(body, 'm_LocalScale'), parent=ref(body, 'm_Father')[0])
        elif cls == 33:
            mf[ref(body, 'm_GameObject')[0]] = ref(body, 'm_Mesh')
        elif cls == 23:
            mats = re.findall(r'- \{fileID: (-?\d+), guid: ([0-9a-f]+)', body.split('m_Materials:')[1]) if 'm_Materials:' in body else []
            mr[ref(body, 'm_GameObject')[0]] = mats[0][1] if mats else None
    # вложенные PropCube / PropTriangle
    insts = []
    for cls, fid, stripped, body in docs(t):
        if cls != 1001: continue
        src = re.search(r'm_SourcePrefab: \{fileID: \d+, guid: ([0-9a-f]+)', body)
        if not src or src.group(1) not in PROPS: continue
        mods = {}
        for m in re.finditer(r"propertyPath: '?([^'\n]+)'?\n\s+value: ?(.*)\n\s+objectReference: \{fileID: (-?\d+)(?:, guid: ([0-9a-f]+))?", body):
            mods[m.group(1)] = (m.group(2).strip(), m.group(4))
        g = lambda k, d: float(mods[k][0]) if k in mods and mods[k][0] not in ('', None) else d
        tr = dict(go=None, pos=[g('m_LocalPosition.x',0), g('m_LocalPosition.y',0), g('m_LocalPosition.z',0)],
                  rot=[g('m_LocalRotation.x',0), g('m_LocalRotation.y',0), g('m_LocalRotation.z',0), g('m_LocalRotation.w',1)],
                  scl=[g('m_LocalScale.x',1), g('m_LocalScale.y',1), g('m_LocalScale.z',1)],
                  parent=ref(body, 'm_TransformParent')[0])
        key = 'inst' + fid
        trs[key] = tr
        mat = mods.get('m_Materials.Array.data[0]', (None, None))[1] or PROPS[src.group(1)][1]
        insts.append((key, PROPS[src.group(1)][0], mat, mods.get('m_Name', ('',))[0]))
    by_go = {v['go']: k for k, v in trs.items()}
    def world(tid):
        tr = trs[tid]; pos, rot, scl = tr['pos'] or [0,0,0], tr['rot'] or [0,0,0,1], tr['scl'] or [1,1,1]
        p = tr['parent']
        if p and p != '0' and p in trs and trs[p]['parent'] not in (None, '0'):  # до корня, не включая сам корень
            ppos, prot, pscl = world(p)
            sp = [pos[i]*pscl[i] for i in range(3)]
            return [a+b for a, b in zip(ppos, qrot(prot, sp))], qmul(prot, rot), [scl[i]*pscl[i] for i in range(3)]
        return pos, rot, scl
    blocks = []
    for go, mesh in mf.items():
        if go not in by_go: continue
        pos, rot, scl = world(by_go[go])
        blocks.append(dict(name=gos.get(go, ''), mesh=f'{mesh[0]}:{mesh[1]}', mat=mr.get(go), pos=[round(v, 3) for v in pos], rot=euler(rot), quat=[round(v, 5) for v in rot], scale=[round(v, 3) for v in scl]))
    for key, shape, mat, name in insts:
        pos, rot, scl = world(key)
        blocks.append(dict(name=name, mesh=shape, mat=mat, pos=[round(v, 3) for v in pos], rot=euler(rot), quat=[round(v, 5) for v in rot], scale=[round(v, 3) for v in scl]))
    return blocks
out = {}
for f in sys.argv[1:]:
    out[os.path.basename(f)[:-7]] = parse(f)
print(json.dumps(out, ensure_ascii=False))
