import importlib.util, sys, random
def load(path,name):
    sp=importlib.util.spec_from_file_location(name,path); m=importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m
START="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
def legal(m,fen):
    m.setup(fen); out=[]
    for x in m.gen(False):
        if m.make(x): out.append(m.uci(x)); m.unmake()
    return out, (m.att(m.KS[m.stm>>3], m.stm^8))
def apply(m,fen,u):
    m.setup(fen)
    for x in m.gen(False):
        if m.uci(x)==u and m.make(x): break
    # rebuild fen
    rows=[]
    for r in range(7,-1,-1):
        row="";e=0
        for f in range(8):
            c=m.B[21+f+10*r]
            if c==0:e+=1
            else:
                if e:row+=str(e);e=0
                row+=("PNBRQK"[(c&7)-1] if c<8 else "pnbrqk"[(c&7)-1])
        if e:row+=str(e)
        rows.append(row)
    cs="".join(ch for b,ch in zip((1,2,4,8),"KQkq") if m.cas&b) or "-"
    ep="-" if not m.ep else "abcdefgh"[(m.ep-21)%10]+str((m.ep-21)//10+1)
    return " ".join(["/".join(rows),"w" if m.stm==0 else "b",cs,ep,str(m.hm),"1"])
def play(A,B,fen,nodes):
    ps=[A,B]; seen={}; hist=[]
    for ply in range(240):
        m=ps[ply%2]
        L,chk=legal(m,fen)
        if not L: return (0 if ply%2==0 else 1) if chk else None  # winner index or draw
        k=" ".join(fen.split()[:4]); seen[k]=seen.get(k,0)+1
        if seen[k]>=3 or int(fen.split()[4])>=100: return None
        # insufficient: only kings
        if len(fen.split()[0].replace("/",""))and all(c in "kK12345678/" for c in fen.split()[0]): return None
        m.NPMS=1; m.NODE_MS=nodes
        u=m.choose_move({"fen":fen,"legal_moves":L,"time_remaining_ms":10**9,"increment_ms":0})
        assert u in L,(u,fen)
        fen=apply(m,fen,u)
    return None
OPEN=["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
def openings(n,seed):
    r=random.Random(seed); out=[]
    m=load("checkm8_alphabeta.py","gen_o")
    while len(out)<n:
        fen=START
        for _ in range(8):
            L,_c=legal(m,fen)
            if not L:break
            fen=apply(m,fen,r.choice(L))
        else: out.append(fen)
    return out
if __name__=="__main__":
    a,b,nodes,n=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4])
    A=load(a,"A");Bm=load(b,"B")
    sc=[0,0,0]
    for fen in openings(n,7):
        for sw in (0,1):
            res=play(*( (A,Bm) if sw==0 else (Bm,A)),fen,nodes)
            if res is None: sc[2]+=1
            else: sc[(res if sw==0 else 1-res)]+=1
        print(sc,flush=True)
    print("A wins,B wins,draws",sc)
