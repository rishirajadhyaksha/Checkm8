const path=require("path");
const root=process.env.HOME+"/mnt/Documents/checkm8/server/";
process.chdir(root);
const fs=require("fs");
const {createBridge}=require(root+"src/bots/bridge");
const mp=require(root+"src/bots/runtimes/micropython");
const { Chess } = require("chess.js");
let code=fs.readFileSync(process.argv[2]||process.env.HOME+"/mnt/Documents/checkm8/bots/checkm8_alphabeta.py","utf8");
if(process.env.DBG) code+="\n_cm=choose_move\ndef choose_move(state):\n    m=_cm(state)\n    print('nodes',nodes,'limit',limit)\n    return m\n";
if(process.env.NPMS) code+="\nNPMS="+process.env.NPMS+"\n";if(process.env.NODE_MS) code+="\nNODE_MS="+process.env.NODE_MS+"\n";
const fens=[
 "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
 "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
 "8/8/4k3/8/8/4K3/4P3/8 w - - 0 1",
 "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
];
(async()=>{
 for (const fen of fens){
  const c=new Chess(fen);
  const legal=c.moves({verbose:true}).map(m=>m.from+m.to+(m.promotion||""));
  const state={fen,legalMoves:legal,turn:c.turn(),timeRemainingMs:+(process.env.TR||60000),incrementMs:0,history:[]};
  const bridge=createBridge({seed:1,maxCalls:5000});
  const t=Date.now();
  const r=await mp.run({code,state,limits:{memoryLimitBytes:16*1024*1024},bridge});
  console.log(fen.slice(0,28), r.ok?r.move:r.reason, legal.includes(r.move)?"legal":"ILLEGAL", (Date.now()-t)+"ms", r.stdout||"");
 }
})();
