// קוד ההטמעה של הרשימות באתר iska.co.il - נטען מוורדפרס בשורה אחת:
//   <script src="https://harav-levin.pages.dev/embed.js"></script>
// (אופציונלי: data-offset="140" = גובה הכותרת הקבועה של האתר; data-type="bonds-private" = לכפות רשימה מסוימת)
// הקוד יוצר את ה-iframe במקום תג הסקריפט, קובע את הרשימה לפי כתובת הדף, ומוסיף: כותרת טבלה צמודה, סרגל גלילה לרוחב צמוד
// ותאריך עדכון בתת-הכותרת. כל שינוי בקובץ הזה חל מיד על כל הדפים (בלי לגעת בוורדפרס).
(function(){
var sc=document.currentScript;
var O=sc&&sc.src?new URL(sc.src).origin:"https://harav-levin.pages.dev";
var f=document.getElementById("hl-frame");
if(!f){f=document.createElement("iframe");f.id="hl-frame";f.style.cssText="width:100%;height:700px;border:0";f.setAttribute("scrolling","no");if(sc&&sc.parentNode){sc.parentNode.insertBefore(f,sc);}else{document.body.appendChild(f);}}
var P=decodeURIComponent(location.pathname),TY=(sc&&sc.getAttribute("data-type"))||(((P.indexOf("חוב")!==-1||P.indexOf("אגח")!==-1)?"bonds":"companies")+"-"+(P.indexOf("כללי")!==-1?"general":"private"));
f.src=O+"/display.html?type="+TY;
/* גובה ה-iframe מתחיל מהגובה האחרון שנשמר (ולא מ-700 הקבועים), וירידה בגובה מתעכבת - כדי שהדף לא יקפוץ בטעינה (שחזור מיקום הגלילה של הדפדפן) */
var HK="hl-h-"+TY,st=null;try{var H0=Number(window.localStorage.getItem(HK));if(Math.sign(H0)===1){f.style.height=H0+"px";}}catch(x){}
function applyH(h){f.style.height=h+"px";try{window.localStorage.setItem(HK,String(h));}catch(x){}}
function setH(h){var c=f.offsetHeight;window.clearTimeout(st);if(Math.sign(h-c+50)!==-1){applyH(h);}else{st=window.setTimeout(function(){applyH(h);},1500);}}
var OFF0=Number(sc&&sc.getAttribute("data-offset"))||140,OFFSET=OFF0,nav=null,nbar=null,spec=null,bar=null,hs=null,sb=null,sbi=null,bi=null,cur=0,lu=0,ps=null;
function build(){
if(!bar){bar=document.createElement("div");bar.id="hl-bar";bar.style.cssText="position:fixed;z-index:99;display:none;overflow:hidden;direction:rtl;box-sizing:border-box";document.body.appendChild(bar);}
bar.innerHTML="";bi=document.createElement("div");bi.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%";bar.appendChild(bi);bar.style.background=spec.bg;bar.style.height=spec.h+"px";bar.style.borderBottom=spec.border;
for(var i=0;i!==spec.cells.length;i=i+1){var c=spec.cells[i],d=document.createElement("div"),t=document.createElement("span");
d.style.cssText="position:absolute;top:0;display:flex;align-items:center;overflow:hidden;box-sizing:border-box;padding:0 12px";
d.style.left=c.x0+"px";d.style.width=c.w+"px";d.style.height=spec.h+"px";d.style.justifyContent=(c.a==="center")?"center":"flex-start";
t.style.cssText="white-space:normal;line-height:1.25;overflow-wrap:anywhere;max-width:100%";t.style.textAlign=c.a;
d.style.color=spec.color;d.style.fontWeight=spec.fw;d.style.fontSize=spec.fs;d.style.borderLeft=c.bl;t.textContent=c.t;d.appendChild(t);bi.appendChild(d);}
move();
}
function buildNav(){
if(!nbar){nbar=document.createElement("div");nbar.id="hl-nav";nbar.style.cssText="position:fixed;z-index:100;display:none;direction:rtl;box-sizing:border-box;display:none";document.body.appendChild(nbar);}
nbar.innerHTML="";nbar.style.background=nav.bg;nbar.style.borderBottom=nav.border;nbar.style.height=nav.h+"px";nbar.style.display="none";nbar.style.flexWrap="nowrap";
for(var i=0;i!==nav.tabs.length;i=i+1){var c=nav.tabs[i],b=document.createElement("button");b.type="button";b.textContent=c.t;
b.style.cssText="flex:1;min-width:0;border:0;cursor:pointer;font-family:inherit;padding:0 .5rem;box-sizing:border-box;height:100%;overflow:hidden;white-space:normal;line-height:1.2";
b.style.color=c.color;b.style.background=c.bg;b.style.fontWeight=c.fw;b.style.fontSize=c.fs;b.style.borderTop=c.bt;
b.setAttribute("data-type",c.type);nbar.appendChild(b);}
nbar.onclick=function(e){var el=e.target;while(el&&el!==nbar&&!el.getAttribute("data-type")){el=el.parentNode;}
if(el&&el!==nbar){f.contentWindow.postMessage({source:"harav-parent",type:"setType",value:el.getAttribute("data-type")},O);}};
}
function setUpd(t){
var tb=document.querySelector(".fusion-page-title-bar");if(!tb){return false;}
var el=document.getElementById("hl-upd");
if(!el){var sec=tb.querySelector(".fusion-page-title-secondary");var h=tb.querySelector("h1");
var col=h?window.getComputedStyle(h).color:"#fff";
if(sec){sec.innerHTML="";el=document.createElement("span");el.id="hl-upd";sec.appendChild(el);}
else{if(!h){return false;}el=document.createElement("div");el.id="hl-upd";h.parentNode.insertBefore(el,h.nextSibling);}
el.style.cssText="display:block;text-align:center;font-size:18px;margin-top:8px;color:"+col+";text-shadow:0 1px 3px rgba(0,0,0,0.6)";}
el.textContent=t;return true;
}
function move(){if(bi){bi.style.transform="translateX("+(0-cur)+"px)";}}
function buildSb(){
if(!sb){sb=document.createElement("div");sb.id="hl-sb";sb.style.cssText="position:fixed;z-index:99;bottom:0;display:none;overflow-x:auto;overflow-y:hidden;direction:rtl;height:18px;background:#f4f7f7";
sbi=document.createElement("div");sbi.style.height="1px";sb.appendChild(sbi);document.body.appendChild(sb);
sb.addEventListener("scroll",function(){if(ps!==null){if(Math.sign(Math.abs(sb.scrollLeft-ps)-1)!==1){ps=null;return;}ps=null;}lu=Date.now();cur=sb.scrollLeft;move();f.contentWindow.postMessage({source:"harav-parent",type:"setScroll",left:cur},O);});}
sbi.style.width=hs.sw+"px";sb.style.width=hs.cw+"px";
if(Math.sign(Date.now()-lu-250)===1){cur=hs.left;if(Math.sign(Math.abs(sb.scrollLeft-hs.left)-1)===1){ps=hs.left;sb.scrollLeft=hs.left;}move();}
}
setUpd("\u00a0");/* שומר מראש את שורת "עודכן לאחרונה" בכותרת הדף, כדי שהכותרת לא תזוז כשהתאריך מגיע */
window.addEventListener("message",function(e){
if(e.origin!==O){return;}
var d=e.data;if(!d){return;}if(d.source!=="harav-levin"){return;}
if(d.type==="resize"){setH(d.height);}
if(d.type==="nav"){nav=d;buildNav();}
if(d.type==="header"){spec=d;build();f.contentWindow.postMessage({source:"harav-parent",type:"v5"},O);}
if(d.type==="hscroll"){hs=d;buildSb();}
if(d.type==="updated"){if(setUpd(d.text)){f.contentWindow.postMessage({source:"harav-parent",type:"updShown"},O);}}
});
/* גובה הכותרת הקבועה של האתר נמדד בכל פריים (אוואדה מכווצת אותה בגלילה), ואם אין כותרת קבועה - data-offset */
function hdrBottom(){var w=window.innerWidth,best=0,pts=[w/2,w*0.25,w*0.75],ids={"hl-bar":1,"hl-nav":1,"hl-sb":1,"ipb":1};
for(var p=0;p!==pts.length;p=p+1){var els=document.elementsFromPoint(pts[p],3);
for(var i=0;i!==els.length;i=i+1){var e=els[i];
while(e&&e!==document.documentElement){var cs=window.getComputedStyle(e);
if(cs.position==="fixed"||cs.position==="sticky"){var r=e.getBoundingClientRect();
if(!ids[e.id]&&r.width>=w*0.6&&r.top<=6&&r.bottom<=260&&r.bottom>best){best=r.bottom;}
break;}
e=e.parentNode;}}}
return Math.round(best);}
function tick(){
var hb=hdrBottom();OFFSET=hb>0?hb:OFF0;
if(!f.offsetWidth){if(bar){bar.style.display="none";}if(sb){sb.style.display="none";}window.requestAnimationFrame(tick);return;}
var r=f.getBoundingClientRect(),wide=Math.sign(Math.floor(window.innerWidth/992))===1;
var OH=OFFSET;
if(nav&&nbar){var nt=r.top+nav.top,non=Math.sign(OFFSET-nt)===1;if(non){non=Math.sign(nt+nav.contentH-nav.h-OFFSET)===1;}
if(non){non=wide;}
if(non){nbar.style.display="flex";nbar.style.top=OFFSET+"px";nbar.style.left=r.left+"px";nbar.style.width=r.width+"px";OH=OFFSET+nav.h;}else{nbar.style.display="none";}}
if(spec){var top=r.top+spec.tableTop;
var show=Math.sign(OH-top)===1;if(show){show=Math.sign(top+spec.tableH-spec.h-OH)===1;}
if(show){show=wide;}
if(show){bar.style.display="block";bar.style.top=OH+"px";bar.style.left=r.left+"px";bar.style.width=r.width+"px";}else{bar.style.display="none";}}
if(hs){if(sb){var t2=r.top+hs.top,sh=Math.sign(hs.sw-hs.cw-1)===1;
if(sh){sh=Math.sign(window.innerHeight-40-t2)===1;}
if(sh){sh=Math.sign(t2+hs.h-window.innerHeight)===1;}
if(sh){sh=Math.sign(t2+hs.h-OFFSET-80)===1;}
if(sh){sh=wide;}
if(sh){sb.style.display="block";sb.style.left=(r.left+hs.x)+"px";}else{sb.style.display="none";}}}
window.requestAnimationFrame(tick);}
window.requestAnimationFrame(tick);
})();
