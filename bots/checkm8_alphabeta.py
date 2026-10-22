# Checkm8 "Alpha" - a self-contained alpha-beta engine in pure Python.
# Own move generator (10x12 mailbox), incremental material+PST eval, zobrist
# TT, PVS, null-move, LMR, killers/history, quiescence, iterative deepening.
# The sandbox has no clock, so search is bounded by a node budget that is
# scaled from the time left on our clock. Library calls are not needed.
import random

MATE = 30000
INF = 31000
V = (0, 100, 320, 330, 500, 900, 0)
V2 = (0, 0, 320, 330, 500, 900, 0)
OFF_N = (-21, -19, -12, -8, 8, 12, 19, 21)
OFF_B = (-11, -9, 9, 11)
OFF_R = (-10, -1, 1, 10)
OFF_K = OFF_B + OFF_R
TBL = {
    1: "KKKKKKKKUUUUUUUUMMOQQOMMLLMPPMLLKKKOOKKKLJIKKIJLLMMGGMMLKKKKKKKK",
    2: "ACEEEECACGKKKKGCEKMNNMKEELNOONLEEKNOONKEELMNNMLECGKLLKGCACEEEECA",
    3: "GIIIIIIGIKKKKKKIIKLMMLKIILLMMLLIIKMMMMKIIMMMMMMIILKKKKLIGIIIIIIG",
    4: "KKKKKKKKLMMMMMMLJKKKKKKJJKKKKKKJJKKKKKKJJKKKKKKJJKKKKKKJKKKLLKKK",
    5: "GIIJJIIGIKKKKKKIIKLLLLKIJKLLLLKJKKLLLLKJILLLLLKIIKLKKKKIGIIJJIIG",
}
KMG = "ECCAACCEECCAACCEECCAACCEECCAACCEGEECCEEGIGGDDGGIOOKFFKOOKQMIKJQM"
KEG = "ACEGGECAEGIKKIGEEIOQQOIEEIQSSQIEEIQSSQIEEIOQQOIEEEKKKKEEAEEEEEEA"

B = [16] * 120
PS = [[0] * 120 for _ in range(16)]
KP = [[[0] * 120, [0] * 120], [[0] * 120, [0] * 120]]
CD = [0] * 120
RR = [0] * 120
FF = [0] * 120
Z = [[0] * 120 for _ in range(16)]
ZC = [0] * 16
ZE = [0] * 120
CM = [15] * 120
NP = [0, 0]
KS = [0, 0]
PL = [set(), set()]
U = []
P = []
TT = {}
HIST = {}
K1 = [0] * 64
K2 = [0] * 64
stm = 0
cas = 0
ep = 0
hm = 0
key = 0
score = 0
nodes = 0
limit = 0
abort = False
_x = 12345


def _rnd():
    global _x
    _x = (_x * 1103515245 + 12345) & 0x3FFFFFFF
    return _x


def _init():
    for r in range(8):
        for f in range(8):
            s = 21 + f + 10 * r
            RR[s] = r
            FF[s] = f
            CD[s] = max(3 - f, f - 4) + max(3 - r, r - 4)
            wi = 8 * (7 - r) + f
            bi = 8 * r + f
            for t in range(1, 6):
                v = (ord(TBL[t][wi]) - 75) * 5
                PS[t][s] = V[t] + v
                PS[t | 8][s] = -(V[t] + (ord(TBL[t][bi]) - 75) * 5)
            PS[1][s] = 100 + (ord(TBL[1][wi]) - 75) * 5
            KP[0][0][s] = (ord(KMG[wi]) - 75) * 5
            KP[0][1][s] = (ord(KMG[bi]) - 75) * 5
            KP[1][0][s] = (ord(KEG[wi]) - 75) * 5
            KP[1][1][s] = (ord(KEG[bi]) - 75) * 5
    for p in range(1, 15):
        for s in range(120):
            Z[p][s] = _rnd()
    for i in range(16):
        ZC[i] = _rnd()
    for s in range(120):
        ZE[s] = _rnd()
    for s, m in ((21, 13), (28, 14), (25, 12), (91, 7), (98, 11), (95, 3)):
        CM[s] = m


_init()
ZS = _rnd()
ZE[0] = 0


def setup(fen):
    global stm, cas, ep, hm, key, score
    p = fen.split()
    for i in range(120):
        B[i] = 16
    NP[0] = NP[1] = 0
    PL[0].clear()
    PL[1].clear()
    key = 0
    score = 0
    rows = p[0].split("/")
    for ri in range(8):
        r = 7 - ri
        f = 0
        for ch in rows[ri]:
            if ch.isdigit():
                for _ in range(int(ch)):
                    B[21 + f + 10 * r] = 0
                    f += 1
            else:
                t = "pnbrqk".index(ch.lower()) + 1
                c = t | (0 if ch.isupper() else 8)
                s = 21 + f + 10 * r
                B[s] = c
                PL[c >> 3].add(s)
                key ^= Z[c][s]
                score += PS[c][s]
                if t == 6:
                    KS[c >> 3] = s
                elif t != 1:
                    NP[c >> 3] += V2[t]
                f += 1
    stm = 0 if p[1] == "w" else 8
    cas = 0
    for ch in p[2]:
        if ch in "KQkq":
            cas |= (1, 2, 4, 8)["KQkq".index(ch)]
    ep = 0
    if p[3] != "-":
        ep = 21 + "abcdefgh".index(p[3][0]) + 10 * (int(p[3][1]) - 1)
    hm = int(p[4]) if len(p) > 4 else 0
    key ^= ZC[cas] ^ ZE[ep]
    if stm:
        key ^= ZS
    del U[:]
    del P[:]
    P.append(key)


def att(s, by):
    B_ = B
    if by == 0:
        if B_[s - 11] == 1 or B_[s - 9] == 1:
            return True
    elif B_[s + 11] == 9 or B_[s + 9] == 9:
        return True
    n = 2 | by
    for o in OFF_N:
        if B_[s + o] == n:
            return True
    k = 6 | by
    q = 5 | by
    bs = 3 | by
    rk = 4 | by
    for o in OFF_B:
        x = s + o
        v = B_[x]
        if v == k:
            return True
        while not v:
            x += o
            v = B_[x]
        if v == bs or v == q:
            return True
    for o in OFF_R:
        x = s + o
        v = B_[x]
        if v == k:
            return True
        while not v:
            x += o
            v = B_[x]
        if v == rk or v == q:
            return True
    return False


def gen(caps):
    me = stm
    mv = []
    add = mv.append
    B_ = B
    d = 10 if me == 0 else -10
    for s in PL[me >> 3]:
        p = B_[s]
        t = p & 7
        if t == 1:
            for o in (d - 1, d + 1):
                x = s + o
                v = B_[x]
                if (v and v != 16 and (v & 8) != me) or x == ep:
                    if x > 90 or x < 29:
                        if caps:
                            add(s | x << 7 | 5 << 14)
                        else:
                            for pr in (5, 4, 3, 2):
                                add(s | x << 7 | pr << 14)
                    else:
                        add(s | x << 7)
            x = s + d
            if not B_[x]:
                if x > 90 or x < 29:
                    if caps:
                        add(s | x << 7 | 5 << 14)
                    else:
                        for pr in (5, 4, 3, 2):
                            add(s | x << 7 | pr << 14)
                elif not caps:
                    add(s | x << 7)
                    if (me == 0 and s < 39) or (me and s > 80):
                        y = x + d
                        if not B_[y]:
                            add(s | y << 7)
        elif t == 2 or t == 6:
            for o in (OFF_N if t == 2 else OFF_K):
                x = s + o
                v = B_[x]
                if not v:
                    if not caps:
                        add(s | x << 7)
                elif v != 16 and (v & 8) != me:
                    add(s | x << 7)
            if t == 6 and not caps:
                if me == 0 and s == 25:
                    if (cas & 1) and not B_[26] and not B_[27] and not att(25, 8) and not att(26, 8):
                        add(s | 27 << 7)
                    if (cas & 2) and not B_[24] and not B_[23] and not B_[22] and not att(25, 8) and not att(24, 8):
                        add(s | 23 << 7)
                elif me and s == 95:
                    if (cas & 4) and not B_[96] and not B_[97] and not att(95, 0) and not att(96, 0):
                        add(s | 97 << 7)
                    if (cas & 8) and not B_[94] and not B_[93] and not B_[92] and not att(95, 0) and not att(94, 0):
                        add(s | 93 << 7)
        else:
            for o in (OFF_B if t == 3 else OFF_R if t == 4 else OFF_K):
                x = s + o
                while not B_[x]:
                    if not caps:
                        add(s | x << 7)
                    x += o
                v = B_[x]
                if v != 16 and (v & 8) != me:
                    add(s | x << 7)
    return mv


def make(m):
    global stm, cas, ep, hm, key, score
    f = m & 127
    t = (m >> 7) & 127
    pr = m >> 14
    p = B[f]
    c = B[t]
    me = stm
    U.append((m, c, cas, ep, hm, key, score))
    k = key ^ ZS ^ ZC[cas] ^ ZE[ep]
    sc = score
    ty = p & 7
    B[f] = 0
    pl = PL[me >> 3]
    pl.discard(f)
    pl.add(t)
    if c:
        sc -= PS[c][t]
        k ^= Z[c][t]
        NP[c >> 3] -= V2[c & 7]
        PL[c >> 3].discard(t)
    q = p
    if ty == 1:
        if t == ep and not c:
            cs = t - 10 if me == 0 else t + 10
            e = B[cs]
            B[cs] = 0
            PL[e >> 3].discard(cs)
            sc -= PS[e][cs]
            k ^= Z[e][cs]
        if pr:
            q = pr | me
            NP[me >> 3] += V2[pr]
    sc += PS[q][t] - PS[p][f]
    k ^= Z[p][f] ^ Z[q][t]
    B[t] = q
    if ty == 6:
        KS[me >> 3] = t
        if t - f == 2:
            r = B[t + 1]
            B[t + 1] = 0
            B[t - 1] = r
            pl.discard(t + 1)
            pl.add(t - 1)
            sc += PS[r][t - 1] - PS[r][t + 1]
            k ^= Z[r][t + 1] ^ Z[r][t - 1]
        elif f - t == 2:
            r = B[t - 2]
            B[t - 2] = 0
            B[t + 1] = r
            pl.discard(t - 2)
            pl.add(t + 1)
            sc += PS[r][t + 1] - PS[r][t - 2]
            k ^= Z[r][t - 2] ^ Z[r][t + 1]
    cas &= CM[f] & CM[t]
    ep = (f + t) >> 1 if ty == 1 and (t - f == 20 or f - t == 20) else 0
    hm = 0 if (ty == 1 or c) else hm + 1
    key = k ^ ZC[cas] ^ ZE[ep]
    score = sc
    stm = me ^ 8
    P.append(key)
    if att(KS[me >> 3], stm):
        unmake()
        return False
    return True


def unmake():
    global stm, cas, ep, hm, key, score
    m, c, cas0, ep0, hm0, key0, sc0 = U.pop()
    P.pop()
    f = m & 127
    t = (m >> 7) & 127
    pr = m >> 14
    me = stm ^ 8
    q = B[t]
    p = (1 | me) if pr else q
    B[f] = p
    B[t] = c
    pl = PL[me >> 3]
    pl.discard(t)
    pl.add(f)
    if c:
        PL[c >> 3].add(t)
    ty = p & 7
    if ty == 1:
        if t == ep0 and not c:
            cs = t - 10 if me == 0 else t + 10
            B[cs] = 1 | (me ^ 8)
            PL[(me ^ 8) >> 3].add(cs)
        if pr:
            NP[me >> 3] -= V2[pr]
    elif ty == 6:
        KS[me >> 3] = f
        if t - f == 2:
            B[t + 1] = B[t - 1]
            B[t - 1] = 0
            pl.discard(t - 1)
            pl.add(t + 1)
        elif f - t == 2:
            B[t - 2] = B[t + 1]
            B[t + 1] = 0
            pl.discard(t + 1)
            pl.add(t - 2)
    if c:
        NP[c >> 3] += V2[c & 7]
    stm = me
    cas = cas0
    ep = ep0
    hm = hm0
    key = key0
    score = sc0


def nullmove():
    global stm, ep, key
    U.append((0, 0, cas, ep, hm, key, score))
    key ^= ZS ^ ZE[ep]
    ep = 0
    stm ^= 8
    P.append(key)


def unnull():
    global stm, ep, key
    m, c, cas0, ep0, hm0, key0, sc0 = U.pop()
    P.pop()
    stm ^= 8
    ep = ep0
    key = key0


def evaluate():
    s = score
    wk = KS[0]
    bk = KS[1]
    eg = 1 if NP[0] + NP[1] < 2600 else 0
    s += KP[eg][0][wk] - KP[eg][1][bk]
    if eg:
        if NP[1] == 0 and s > 250:
            s += 10 * CD[bk] + 4 * (14 - abs(RR[wk] - RR[bk]) - abs(FF[wk] - FF[bk]))
        elif NP[0] == 0 and s < -250:
            s -= 10 * CD[wk] + 4 * (14 - abs(RR[wk] - RR[bk]) - abs(FF[wk] - FF[bk]))
    return (s if stm == 0 else -s) + 8


def order(moves, ttm, ply):
    out = []
    k1 = K1[ply]
    k2 = K2[ply]
    for m in moves:
        t = (m >> 7) & 127
        c = B[t]
        if m == ttm:
            s = 8000
        elif c:
            s = 4000 + (c & 7) * 16 - (B[m & 127] & 7)
        elif m >> 14:
            s = 3500 + (m >> 14)
        elif m == k1:
            s = 3000
        elif m == k2:
            s = 2999
        elif t == ep and (B[m & 127] & 7) == 1:
            s = 4000 + 15
        else:
            s = HIST.get(m & 16383, 0)
        out.append(s << 17 | m)
    out.sort(reverse=True)
    return out


def qs(alpha, beta, ply):
    global nodes, abort
    nodes += 1
    if nodes > limit:
        abort = True
        return 0
    sp = evaluate()
    if sp >= beta:
        return sp
    if sp > alpha:
        alpha = sp
    if ply > 40:
        return sp
    for x in order(gen(True), 0, 63):
        m = x & 131071
        c = B[(m >> 7) & 127]
        if c and not (m >> 14) and sp + V[c & 7] + 200 < alpha:
            continue
        if not make(m):
            continue
        sc = -qs(-beta, -alpha, ply + 1)
        unmake()
        if abort:
            return 0
        if sc >= beta:
            return sc
        if sc > alpha:
            alpha = sc
    return alpha


def ab(d, alpha, beta, ply, nul):
    global nodes, abort
    nodes += 1
    if nodes > limit:
        abort = True
        return 0
    if hm >= 100:
        return 0
    n = len(P)
    if hm >= 4:
        i = n - 3
        lo = n - 1 - hm
        while i >= lo and i >= 0:
            if P[i] == key:
                return 0
            i -= 2
    me = stm
    chk = att(KS[me >> 3], me ^ 8)
    if chk:
        d += 1
    if d <= 0:
        return qs(alpha, beta, ply)
    if ply >= 60:
        return evaluate()
    ttm = 0
    e = TT.get(key)
    if e:
        ed, ef, es, ttm = e
        if ed >= d:
            if es > MATE - 200:
                es -= ply
            elif es < -MATE + 200:
                es += ply
            if ef == 0 or (ef == 1 and es >= beta) or (ef == 2 and es <= alpha):
                return es
    pv = beta - alpha > 1
    se = 0
    if not pv and not chk and NP[me >> 3] > 0 and beta < MATE - 200 and beta > -MATE + 200:
        if d <= 3:
            se = evaluate()
            if se - 130 * d >= beta:
                return se
        if nul and d >= 3:
            nullmove()
            sc = -ab(d - 3, -beta, -beta + 1, ply + 1, False)
            unnull()
            if abort:
                return 0
            if sc >= beta:
                return beta if sc > MATE - 200 else sc
    a0 = alpha
    best = -INF
    bm = 0
    legal = 0
    for x in order(gen(False), ttm, ply):
        m = x & 131071
        iscap = B[(m >> 7) & 127] or (m >> 14)
        if d <= 2 and legal and not iscap and not chk and not pv and se and se + 100 + 120 * d <= alpha:
            continue
        if not make(m):
            continue
        legal += 1
        if legal == 1:
            sc = -ab(d - 1, -beta, -alpha, ply + 1, True)
        else:
            r = 1 if (legal > 4 and d >= 3 and not iscap and not chk) else 0
            sc = -ab(d - 1 - r, -alpha - 1, -alpha, ply + 1, True)
            if sc > alpha and (r or sc < beta):
                sc = -ab(d - 1, -beta, -alpha, ply + 1, True)
        unmake()
        if abort:
            return 0
        if sc > best:
            best = sc
            bm = m
            if sc > alpha:
                alpha = sc
                if sc >= beta:
                    if not iscap:
                        if K1[ply] != m:
                            K2[ply] = K1[ply]
                            K1[ply] = m
                        h = (m & 16383)
                        HIST[h] = min(2900, HIST.get(h, 0) + d * d)
                    break
    if not legal:
        return -MATE + ply if chk else 0
    if len(TT) > 30000:
        TT.clear()
    fl = 2 if best <= a0 else (1 if best >= beta else 0)
    st = best
    if st > MATE - 200:
        st += ply
    elif st < -MATE + 200:
        st -= ply
    TT[key] = (d, fl, st, bm)
    return best


def uci(m):
    f = m & 127
    t = (m >> 7) & 127
    s = "abcdefgh"[FF[f]] + str(RR[f] + 1) + "abcdefgh"[FF[t]] + str(RR[t] + 1)
    pr = m >> 14
    return s + "??nbrq"[pr] if pr else s


BOOK = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w": ("e2e4", "d2d4", "g1f3", "c2c4"),
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b": ("c7c5", "e7e5", "e7e6", "c7c6"),
    "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b": ("d7d5", "g8f6", "e7e6"),
    "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b": ("d7d5", "g8f6", "c7c5"),
    "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b": ("e7e5", "g8f6", "c7c5"),
}


def choose_move(state):
    global nodes, limit, abort
    fen = state["fen"]
    legal = state["legal_moves"]
    if len(legal) == 1:
        return legal[0]
    bk = BOOK.get(" ".join(fen.split()[:2]))
    if bk:
        ok = [m for m in bk if m in legal]
        if ok:
            return ok[int(random.random() * len(ok))]
    setup(fen)
    tr = state.get("time_remaining_ms") or 60000
    inc = state.get("increment_ms") or 0
    ms = min(NODE_MS, max(40, tr / 8 + inc * 0.7))
    limit = int(ms * NPMS)
    nodes = 0
    abort = False
    TT.clear()
    HIST.clear()
    for i in range(64):
        K1[i] = K2[i] = 0
    root = []
    lset = set(legal)
    for m in gen(False):
        if uci(m) in lset and make(m):
            unmake()
            root.append(m)
    if not root:
        return legal[0]
    best = root[0]
    bs = 0
    d = 1
    while d < 40:
        alpha = -INF
        cur = None
        curs = -INF
        scores = {}
        for m in root:
            make(m)
            if cur is None:
                sc = -ab(d - 1, -INF, -alpha, 1, True)
            else:
                sc = -ab(d - 1, -alpha - 1, -alpha, 1, True)
                if sc > alpha and not abort:
                    sc = -ab(d - 1, -INF, -alpha, 1, True)
            unmake()
            if abort:
                break
            scores[m] = sc
            if sc > curs:
                curs = sc
                cur = m
                if sc > alpha:
                    alpha = sc
        if cur is not None:
            best = cur
            bs = curs
            if len(scores) == len(root):
                root.sort(key=lambda z: -scores[z])
            else:
                root.remove(cur)
                root.insert(0, cur)
        if abort or bs > MATE - 100 or bs < -MATE + 100:
            break
        if nodes * 3 > limit:
            break
        d += 1
    return uci(best)


NPMS = 2.2
NODE_MS = 3600
