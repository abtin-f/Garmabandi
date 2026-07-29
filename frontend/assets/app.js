/* API base — relative path so it works on any domain (localhost in dev,
   garmabandi.ir in production). The backend serves both API and frontend,
   so a same-origin relative path is correct in every environment. */
const API="/api";
const APP_VERSION="1.2.1";
const PER_PAGE=12;
function tIco(t,sz){return ic(TI[t]||"file-text",sz||16);}
const TI={book:"book",chapter:"layers",image:"image",article:"file-text",bundle:"package"};
const TC={book:"book-b",chapter:"ch-b",image:"img-b",article:"art-b",bundle:"book-b"};
const TL={book:"کتاب",chapter:"فصل",image:"تصویر فنی",article:"مقاله",bundle:"پکیج"};
const BGD={book:"linear-gradient(148deg,#12192a,#080d17)",chapter:"linear-gradient(148deg,#0e1520,#060d18)",image:"linear-gradient(148deg,#131a14,#080e0a)",article:"linear-gradient(148deg,#1a1510,#100d08)"};
const BGL={book:"linear-gradient(148deg,#dde3ed,#ccd4e0)",chapter:"linear-gradient(148deg,#d8e0ea,#c8d2e0)",image:"linear-gradient(148deg,#d8e4d8,#c8d8c8)",article:"linear-gradient(148deg,#e4ddd8,#d4ccc4)"};

let token=localStorage.getItem("tb_tk")||null;
let me=JSON.parse(localStorage.getItem("tb_me")||"null");
let allProds=[];
let isMode="g",sfType="all",curPage=1,filteredProds=[];
let pendBuy=null,selRating=0;
let cart=JSON.parse(localStorage.getItem("tb_cart")||"[]");
let camStream=null,camInterval=null,isTimer=null;
let camCanvas=null,camCtx=null,camBD=null,camScanBusy=false,camStart=0,camHinted=false;

/* THEME — circular toggle button; sun (light) / moon (dark) cross-fade + rotate via [data-theme] (pure CSS) */
function themeSwitchInner(){return `<span class="tt-ic tt-sun">${ic('sun',18)}</span><span class="tt-ic tt-moon">${ic('moon',18)}</span>`;}
function themeSwitchHTML(){return `<button class="theme-tog" onclick="toggleTheme()" id="themeBtn" role="switch" aria-label="تغییر حالت روشن و تاریک">${themeSwitchInner()}</button>`;}
(()=>{const t=localStorage.getItem("tb_theme")||"light";document.documentElement.setAttribute("data-theme",t);document.addEventListener("DOMContentLoaded",()=>{const b=document.getElementById("themeBtn");if(b&&!b.querySelector(".tt-ic"))b.innerHTML=themeSwitchInner();});})();
/* flip the theme — the switch is fully CSS-driven by [data-theme], so we just
   toggle the attribute + persist it (no icon rebuilding needed) */
function toggleTheme(){const c=document.documentElement.getAttribute("data-theme"),n=c==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",n);localStorage.setItem("tb_theme",n);}
function isDark(){return document.documentElement.getAttribute("data-theme")==="dark";}
/* Mirror the auth token into a cookie so server-side middleware (e.g. the
   maintenance gate) can recognise an admin on a plain page navigation —
   browser navigations don't send the Authorization header, but do send cookies. */
function syncAuthCookie(){
  try{
    if(token)document.cookie="tb_tk="+encodeURIComponent(token)+";path=/;max-age=2592000;samesite=lax";
    else document.cookie="tb_tk=;path=/;max-age=0;samesite=lax";
  }catch{}
}
syncAuthCookie();
/* HTML-escape helper — keeps user/admin text safe when injected into markup */
function escHtml(s){const d=document.createElement("div");d.textContent=s==null?"":String(s);return d.innerHTML;}

/* ─── Name validation (shared by register + profile) ───
   • First name: no English letters, max 10 chars
   • Last name: max 15 chars */
function validateName(firstName,lastName){
  const fn=(firstName||"").trim(),ln=(lastName||"").trim();
  if(!fn)return{ok:false,msg:"نام الزامی است"};
  if(/[A-Za-z]/.test(fn))return{ok:false,msg:"نام نباید شامل حروف انگلیسی باشد"};
  if(fn.length>10)return{ok:false,msg:"نام حداکثر ۱۰ کاراکتر است"};
  if(/[A-Za-z]/.test(ln))return{ok:false,msg:"نام خانوادگی نباید شامل حروف انگلیسی باشد"};
  if(ln.length>15)return{ok:false,msg:"نام خانوادگی حداکثر ۱۵ کاراکتر است"};
  return{ok:true};
}
/* live input filter: strips English letters as the user types the first name */
function filterFaName(el){const v=el.value;const f=v.replace(/[A-Za-z]/g,"");if(f!==v)el.value=f;}

/* LOADER */
function hideLoader(){const l=document.getElementById("loader");if(l)l.classList.add("hidden");}

/* HELPERS */
async function api(m,p,b){
  const o={method:m,headers:{}};
  if(token)o.headers["Authorization"]="Bearer "+token;
  if(b instanceof FormData){
    /* multipart upload — browser sets Content-Type + boundary */
    o.body=b;
  }else if(b){
    o.headers["Content-Type"]="application/json";
    o.body=JSON.stringify(b);
  }
  const r=await fetch(API+p,o);const d=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(d.error||"خطا");e.code=d.code;e.status=r.status;e.retryAfter=d.retryAfter;throw e;}
  return d;
}
function toast(msg,t="nfo"){const el=document.createElement("div");el.className="tst "+t;el.textContent=msg;document.getElementById("toasts").appendChild(el);setTimeout(()=>{el.style.opacity="0";el.style.transition="opacity .3s";setTimeout(()=>el.remove(),300);},3200);}
function closeOvl(id){document.getElementById(id).classList.remove("on");}
document.querySelectorAll(".ovl").forEach(o=>o.addEventListener("click",e=>{if(e.target===o)o.classList.remove("on");}));

/* MOBILE TAB BAR — active state is set by go() */
/* Dashboard sub-sections still use showDV() */
function showMobDashBar(v){} /* kept for backward compat — no-op */
function openMobMenu(){} /* kept for backward compat — no-op */
function closeMobMenu(){}

/* NAV */
function go(pg,data){
  /* ─── MULTI-PAGE NAVIGATION ─── */
  /* Map logical page name → real HTML file */
  const PAGES={
    home:"index.html", shop:"shop.html", qr:"qr.html",
    about:"about.html", contact:"contact.html", terms:"terms.html",
    dash:"dashboard.html", checkout:"checkout.html", detail:"detail.html"
  };
  /* Detail page carries the product id as a query param.
     We intentionally do NOT stash the whole product object in
     sessionStorage — a base64 image could blow the ~5MB quota and
     silently break the detail page. The id is enough; detail.html
     fetches fresh (lightweight) data from the API. */
  if(pg==="detail"&&data){
    const id=typeof data==="object"?data.id:data;
    location.href="detail.html?id="+encodeURIComponent(id);
    return;
  }
  const file=PAGES[pg]||"index.html";
  /* If we're already on that page, just scroll up; else navigate */
  const here=(location.pathname.split("/").pop()||"index.html");
  if(here===file){window.scrollTo({top:0,behavior:"smooth"});return;}
  location.href=file;
}
function renderNav(){if(typeof renderMobMenuAuth==="function")setTimeout(renderMobMenuAuth,0);
  const el=document.getElementById("navActs");
  const cc=cart.length;
  let h=themeSwitchHTML();
  h+=`<button class="cart-btn" id="cartBtn" onclick="openCart()" title="سبد خرید"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg><span class="cart-count ${cc>0?"show":""}" id="cartCount">${cc}</span></button>`;
  if(me){
    const nm=me.firstName?(me.firstName+(me.lastName?" "+me.lastName:"")):me.phone;
    if(me.isAdmin)h+=`<a href="/admin.html" target="_blank" class="adm-pill">${ic('key',16)} ادمین</a>`;
    h+=`<div class="u-pill" onclick="go('dash')"><div class="u-dot"></div><span class="u-nm">${nm}</span></div>`;
  }else{
    h+=`<button class="nb" onclick="openAuth('login')">ورود</button><button class="nb fill" onclick="openAuth('register')">ثبت‌نام</button>`;
  }
  el.innerHTML=h;
}
/* nav scroll state — rAF-throttled + only writes when the state changes,
   so scrolling stays smooth on low-end devices */
(function(){
  let ticking=false,lastScrolled=null,lastTop=null;
  function update(){
    ticking=false;
    const sc=scrollY>30,top=scrollY>40?"8px":"14px";
    if(sc!==lastScrolled){const n=document.getElementById("nav");if(n)n.classList.toggle("scrolled",sc);lastScrolled=sc;}
    if(top!==lastTop){const w=document.getElementById("nav-wrap");if(w)w.style.top=top;lastTop=top;}
  }
  window.addEventListener("scroll",()=>{if(!ticking){ticking=true;requestAnimationFrame(update);}},{passive:true});
})();

/* ═══════════════════════════════════════════════════════════
   AUTH — ورود / ثبت‌نام / تایید کد پیامکی / فراموشی رمز
   ───────────────────────────────────────────────────────────
   مرحله‌های تایید کد و فراموشی رمز به‌جای تکرار در ۹ فایل HTML،
   یک‌بار از همین‌جا داخل مودال #authOvl تزریق می‌شوند.
   ═══════════════════════════════════════════════════════════ */
const AUTH_PANELS=["fL","fR","fF","fO","fP"];

/* تزریق پنل‌های اضافه به مودال (فقط یک‌بار در هر صفحه) */
function authExtras(){
  const fR=document.getElementById("fR");
  if(!fR||document.getElementById("fO"))return;

  /* لینک «رمز عبور را فراموش کرده‌ام» زیر دکمه‌ی ورود */
  const fL=document.getElementById("fL");
  if(fL&&!document.getElementById("authFgLink")){
    const d=document.createElement("div");d.className="auth-alt";
    d.innerHTML='<button type="button" id="authFgLink">رمز عبور خود را فراموش کرده‌اید؟</button>';
    fL.appendChild(d);
    d.firstChild.addEventListener("click",()=>swA("forgot"));
  }
  /* جعبه‌ی هشدار داخل فرم ثبت‌نام (نام تکراری) */
  if(!document.getElementById("regWarn"))
    fR.insertAdjacentHTML("afterbegin",authWarnBox("regWarn"));

  const ICO_PHONE='<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18.5h2"/></svg>';
  const ICO_LOCK ='<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

  fR.insertAdjacentHTML("afterend",
  /* ── فراموشی رمز: گرفتن شماره ── */
  '<div id="fF" style="display:none">'+
    '<div class="otp-head"><div class="otp-ico">'+ICO_LOCK+'</div>'+
      '<div class="otp-ttl">بازیابی رمز عبور</div>'+
      '<p class="otp-sub">شماره موبایلی که با آن ثبت‌نام کرده‌اید را وارد کنید تا کد تایید برایتان پیامک شود.</p></div>'+
    '<div style="height:.9rem"></div>'+
    authWarnBox("fgWarn")+
    '<div class="fld"><label>شماره موبایل</label><input id="fPh" type="tel" inputmode="numeric" placeholder="09123456789"></div>'+
    '<button class="btn-bl" id="btnF">ارسال کد تایید</button>'+
    '<div class="auth-alt"><button type="button" id="fgBack">بازگشت به ورود</button></div>'+
  '</div>'+

  /* ── مرحله‌ی تایید کد ── */
  '<div id="fO" style="display:none">'+
    '<div class="otp-head"><div class="otp-ico">'+ICO_PHONE+'</div>'+
      '<div class="otp-ttl">کد تایید را وارد کنید</div>'+
      '<p class="otp-sub">کد ۵ رقمی به شماره <b id="otpPhone"></b> پیامک شد</p></div>'+
    '<div class="otp-stage" id="otpStage">'+
      '<input id="otpInput" class="otp-hid" type="text" inputmode="numeric" pattern="[0-9]*" '+
        'autocomplete="one-time-code" maxlength="5" aria-label="کد تایید">'+
      '<div class="otp-cells" id="otpCells"></div>'+
      '<div class="otp-ok"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>'+
    '</div>'+
    '<div class="otp-err" id="otpErr"></div>'+
    '<button class="btn-bl" id="otpBtn" disabled>تایید و ادامه</button>'+
    '<div class="otp-foot">'+
      '<button class="otp-link" id="otpResendBtn" disabled>ارسال مجدد کد</button>'+
      '<span class="otp-timer" id="otpTimer"></span>'+
      '<button class="otp-link" id="otpBackBtn">تغییر شماره</button>'+
    '</div>'+
  '</div>'+

  /* ── تعیین رمز جدید ── */
  '<div id="fP" style="display:none">'+
    '<div class="otp-head"><div class="otp-ico">'+ICO_LOCK+'</div>'+
      '<div class="otp-ttl">رمز عبور جدید</div>'+
      '<p class="otp-sub">شماره شما تایید شد. حالا یک رمز عبور تازه انتخاب کنید.</p></div>'+
    '<div style="height:.9rem"></div>'+
    '<div class="fld"><label>رمز عبور جدید</label><input id="npPs" type="password" placeholder="••••••"></div>'+
    '<div class="fld"><label>تکرار رمز عبور</label><input id="npPs2" type="password" placeholder="••••••"></div>'+
    '<button class="btn-bl" id="btnNP">ثبت رمز جدید</button>'+
  '</div>');

  /* رویدادها */
  document.getElementById("btnF").addEventListener("click",doForgotSend);
  document.getElementById("fgBack").addEventListener("click",()=>swA("login"));
  document.getElementById("btnNP").addEventListener("click",doResetPassword);
  document.getElementById("otpBtn").addEventListener("click",otpVerify);
  document.getElementById("otpResendBtn").addEventListener("click",otpResend);
  document.getElementById("otpBackBtn").addEventListener("click",otpBack);
  document.getElementById("fPh").addEventListener("keydown",e=>{if(e.key==="Enter")doForgotSend();});
  document.getElementById("npPs2").addEventListener("keydown",e=>{if(e.key==="Enter")doResetPassword();});

  const inp=document.getElementById("otpInput");
  inp.addEventListener("input",()=>{otpRender();
    if(inp.value.replace(/\D/g,"").length===5&&!otpBusy)setTimeout(otpVerify,120);});
  inp.addEventListener("focus",otpRender);
  inp.addEventListener("blur",otpRender);
  inp.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();otpVerify();}});
  document.getElementById("otpStage").addEventListener("click",()=>{if(!otpBusy)inp.focus();});
  otpBuildCells();
}
function authWarnBox(id){
  return '<div class="auth-warn" id="'+id+'">'+
    '<svg viewBox="0 0 24 24" stroke-linecap="round"><circle cx="12" cy="12" r="9.2"/><path d="M12 7.6v5.2M12 16.3v.1"/></svg>'+
    '<span></span></div>';
}
/* نمایش/پنهان کردن جعبه‌ی هشدار */
function authWarn(id,msg,withRegister){
  const b=document.getElementById(id);if(!b)return;
  if(!msg){b.classList.remove("on");return;}
  const s=b.querySelector("span");
  s.textContent=msg;
  if(withRegister){
    const btn=document.createElement("button");
    btn.type="button";btn.className="otp-link";btn.style.marginRight=".4rem";
    btn.textContent="ساخت حساب جدید";
    btn.addEventListener("click",()=>swA("register"));
    s.appendChild(document.createElement("br"));s.appendChild(btn);
  }
  b.classList.add("on");
}

function openAuth(tab){authExtras();document.getElementById("authOvl").classList.add("on");swA(tab||"login");}
function swA(t){
  authExtras();
  const tabs=document.querySelector("#authOvl .atabs");
  const isTab=(t==="login"||t==="register");
  if(tabs)tabs.style.display=isTab?"":"none";
  const atL=document.getElementById("atL"),atR=document.getElementById("atR");
  if(atL)atL.classList.toggle("on",t==="login");
  if(atR)atR.classList.toggle("on",t==="register");
  const show={login:"fL",register:"fR",forgot:"fF",otp:"fO",newpass:"fP"}[t]||"fL";
  AUTH_PANELS.forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=id===show?"":"none";});
  if(t!=="otp")otpStopTimer();
  if(t==="forgot"){authWarn("fgWarn","");setTimeout(()=>document.getElementById("fPh")?.focus(),60);}
  if(t==="register")authWarn("regWarn","");
  if(t==="newpass")setTimeout(()=>document.getElementById("npPs")?.focus(),60);
}
async function doLogin(){const ph=document.getElementById("lPh").value.trim(),ps=document.getElementById("lPs").value;const btn=document.getElementById("btnL");btn.disabled=true;btn.textContent="...";
  try{const d=await api("POST","/auth/login",{phone:ph,password:ps});token=d.token;me=d.user;localStorage.setItem("tb_tk",token);localStorage.setItem("tb_me",JSON.stringify(me));syncAuthCookie();closeOvl("authOvl");renderNav();toast(" خوش آمدید","ok");if(pendBuy){setTimeout(()=>buyProduct(pendBuy),300);pendBuy=null;}}
  catch(e){toast(e.message,"err");}finally{btn.disabled=false;btn.textContent="ورود";}}
/* پس از ورود/ثبت‌نام موفق — ذخیره‌ی توکن و بستن مودال */
function authDone(d,msg){
  token=d.token;me=d.user;
  localStorage.setItem("tb_tk",token);localStorage.setItem("tb_me",JSON.stringify(me));
  syncAuthCookie();closeOvl("authOvl");renderNav();toast(msg,"ok");
  setTimeout(()=>{swA("login");otpReset();},350);
  if(typeof pendBuy!=="undefined"&&pendBuy){setTimeout(()=>buyProduct(pendBuy),300);pendBuy=null;}
}

/* ── ثبت‌نام: مرحله‌ی اول → درخواست کد تایید ── */
async function doRegister(){
  authExtras();
  const fn=document.getElementById("rFn").value.trim(),
        ln=document.getElementById("rLn").value.trim(),
        ph=document.getElementById("rPh").value.trim(),
        pw=document.getElementById("rPs").value,
        pw2=document.getElementById("rPs2").value;
  authWarn("regWarn","");
  const nv=validateName(fn,ln);if(!nv.ok){toast(nv.msg,"err");return;}
  if(!/^09[0-9]{9}$/.test(ph)){toast("شماره موبایل معتبر نیست","err");return;}
  if(pw.length<6){toast("رمز حداقل ۶ کاراکتر","err");return;}
  if(pw!==pw2){toast("رمزها یکسان نیستند","err");return;}
  const btn=document.getElementById("btnR");btn.disabled=true;btn.textContent="در حال ارسال کد…";
  try{
    const d=await api("POST","/auth/otp/send",{purpose:"register",phone:ph,password:pw,firstName:fn,lastName:ln});
    otpStart({purpose:"register",phone:ph,back:"register",resendIn:d.resendIn||60,devCode:d.devCode});
  }catch(e){
    /* نام و نام خانوادگی تکراری → پیام داخل فرم، نه فقط toast */
    if(e.code==="NAME_TAKEN"){authWarn("regWarn",e.message);toast("نام و نام خانوادگی تکراری است","err");}
    /* کد همین چند لحظه پیش فرستاده شده — به‌جای خطا، برو به مرحله‌ی کد */
    else if(e.status===429&&e.retryAfter)otpStart({purpose:"register",phone:ph,back:"register",resendIn:e.retryAfter,resent:true});
    else toast(e.message,"err");
  }finally{btn.disabled=false;btn.textContent="ساخت حساب";}
}

/* ── فراموشی رمز: مرحله‌ی اول → بررسی وجود کاربر و ارسال کد ── */
async function doForgotSend(){
  authExtras();
  const ph=document.getElementById("fPh").value.trim();
  authWarn("fgWarn","");
  if(!/^09[0-9]{9}$/.test(ph)){toast("شماره موبایل معتبر نیست","err");return;}
  const btn=document.getElementById("btnF");btn.disabled=true;btn.textContent="در حال ارسال کد…";
  try{
    const d=await api("POST","/auth/otp/send",{purpose:"reset",phone:ph});
    otpStart({purpose:"reset",phone:ph,back:"forgot",resendIn:d.resendIn||60,devCode:d.devCode});
  }catch(e){
    /* شماره‌ای که اصلاً حساب ندارد */
    if(e.code==="NO_ACCOUNT")authWarn("fgWarn",e.message,true);
    else if(e.status===429&&e.retryAfter)otpStart({purpose:"reset",phone:ph,back:"forgot",resendIn:e.retryAfter,resent:true});
    else toast(e.message,"err");
  }finally{btn.disabled=false;btn.textContent="ارسال کد تایید";}
}

/* ── فراموشی رمز: مرحله‌ی آخر → ثبت رمز جدید ── */
async function doResetPassword(){
  const p1=document.getElementById("npPs").value,p2=document.getElementById("npPs2").value;
  if(p1.length<6){toast("رمز حداقل ۶ کاراکتر","err");return;}
  if(p1!==p2){toast("رمزها یکسان نیستند","err");return;}
  if(!otpCtx||!otpCtx.resetToken){toast("مهلت تمام شد — از ابتدا تلاش کنید","err");swA("forgot");return;}
  const btn=document.getElementById("btnNP");btn.disabled=true;btn.textContent="…";
  try{
    const d=await api("POST","/auth/reset-password",{resetToken:otpCtx.resetToken,password:p1});
    document.getElementById("npPs").value="";document.getElementById("npPs2").value="";
    authDone(d,"رمز عبور تغییر کرد — خوش آمدید");
  }catch(e){toast(e.message,"err");if(e.status===401)swA("forgot");}
  finally{btn.disabled=false;btn.textContent="ثبت رمز جدید";}
}

/* ═══════════════════════════════════════════════════════════
   OTP — منطق مرحله‌ی کد تایید
   ───────────────────────────────────────────────────────────
   یک input نامرئی، نه پنج تا: خانه‌ها فقط نمایشی‌اند و از روی
   input.value رندر می‌شوند. این‌طور backspace، paste، انتخاب متن،
   کیبورد عددی موبایل و autofill پیامک رایگان کار می‌کنند.
   ═══════════════════════════════════════════════════════════ */
let otpCtx=null,otpBusy=false,otpTimerId=null,otpLeft=0;
const otpWait=ms=>new Promise(r=>setTimeout(r,ms));

function otpBuildCells(){
  const w=document.getElementById("otpCells");if(!w)return;
  w.innerHTML="";
  for(let i=0;i<5;i++){const c=document.createElement("div");c.className="otp-cell";c.dataset.r="";w.appendChild(c);}
}
/* رندر تفاضلی — هر خانه در dataset.r نگه می‌دارد الان چه چیزی نشان
   می‌دهد و فقط وقتی عوض شده بازنویسی می‌شود؛ وگرنه مرورگر عنصر را
   از نو می‌سازد و انیمیشن ورود روی ارقام قبلی هم دوباره اجرا می‌شود. */
function otpRender(){
  const inp=document.getElementById("otpInput");if(!inp)return;
  const v=inp.value.replace(/\D/g,"").slice(0,5);
  if(inp.value!==v)inp.value=v;
  const focused=document.activeElement===inp;
  document.querySelectorAll("#otpCells .otp-cell").forEach((c,i)=>{
    const cur=focused&&i===v.length&&!otpBusy;
    const want=(v[i]||"")+"|"+(cur?"c":"");
    if(c.dataset.r===want)return;
    c.dataset.r=want;
    c.classList.toggle("filled",!!v[i]);
    c.classList.toggle("cur",cur);
    c.innerHTML=v[i]?'<span class="otp-dg">'+v[i]+'</span>':(cur?'<span class="otp-crt"></span>':"");
  });
  const btn=document.getElementById("otpBtn");
  if(btn)btn.disabled=otpBusy||v.length<5;
}
function otpErr(msg){
  const e=document.getElementById("otpErr");if(!e)return;
  e.textContent=msg||"";e.classList.toggle("on",!!msg);
}
function otpReset(){
  const stage=document.getElementById("otpStage");
  if(stage)stage.classList.remove("spin","merge","done","bad");
  const inp=document.getElementById("otpInput");if(inp)inp.value="";
  otpBusy=false;otpErr("");otpBuildCells();otpRender();
}
/* شروع مرحله‌ی کد */
function otpStart(ctx){
  otpCtx=ctx;otpReset();
  document.getElementById("otpPhone").textContent=ctx.phone;
  swA("otp");
  otpStartTimer(ctx.resendIn||60);
  setTimeout(()=>{document.getElementById("otpInput").focus();otpRender();},120);
  /* حالت توسعه (OTP_DEV_MODE=true روی سرور) */
  if(ctx.devCode){console.log("[OTP dev] کد:",ctx.devCode);toast("کد تست: "+ctx.devCode,"nfo");}
  else if(ctx.resent)toast("کد قبلی هنوز معتبر است","nfo");
  else toast("کد تایید پیامک شد","ok");
}
function otpBack(){
  if(otpBusy)return;
  otpStopTimer();
  swA(otpCtx&&otpCtx.back==="forgot"?"forgot":"register");
}
function otpStartTimer(sec){
  otpStopTimer();otpLeft=sec;
  const btn=document.getElementById("otpResendBtn"),t=document.getElementById("otpTimer");
  const tick=()=>{
    if(otpLeft<=0){otpStopTimer();if(btn)btn.disabled=false;if(t)t.textContent="";return;}
    if(btn)btn.disabled=true;
    if(t)t.textContent="ارسال مجدد تا "+otpLeft+" ثانیه";
    otpLeft--;
  };
  tick();otpTimerId=setInterval(tick,1000);
}
function otpStopTimer(){if(otpTimerId){clearInterval(otpTimerId);otpTimerId=null;}}

async function otpResend(){
  if(!otpCtx||otpBusy)return;
  const btn=document.getElementById("otpResendBtn");btn.disabled=true;
  otpErr("");
  try{
    const body=otpCtx.purpose==="register"
      ? {purpose:"register",phone:otpCtx.phone,
         password:document.getElementById("rPs").value,
         firstName:document.getElementById("rFn").value.trim(),
         lastName:document.getElementById("rLn").value.trim()}
      : {purpose:"reset",phone:otpCtx.phone};
    const d=await api("POST","/auth/otp/send",body);
    otpReset();document.getElementById("otpInput").focus();
    otpStartTimer(d.resendIn||60);
    if(d.devCode){console.log("[OTP dev] کد:",d.devCode);toast("کد تست: "+d.devCode,"nfo");}
    else toast("کد جدید ارسال شد","ok");
  }catch(e){
    otpErr(e.message);
    otpStartTimer(e.retryAfter||30);
  }
}

/* محاسبه‌ی جابه‌جایی هر خانه: از چیدمان ردیفی به پنج‌ضلعی، و از آنجا به مرکز */
function otpLayout(){
  const wrap=document.getElementById("otpCells");if(!wrap)return;
  const wr=wrap.getBoundingClientRect(),cx=wr.width/2,cy=wr.height/2;
  const R=Math.max(30,Math.min(38,wr.width*.26));
  [...wrap.querySelectorAll(".otp-cell")].forEach((c,i)=>{
    const r=c.getBoundingClientRect();
    const ox=r.left-wr.left+r.width/2,oy=r.top-wr.top+r.height/2;
    const a=(-90+i*72)*Math.PI/180;                 /* پنج نقطه با فاصله‌ی ۷۲ درجه */
    c.style.setProperty("--tx",(cx+R*Math.cos(a)-ox).toFixed(1)+"px");
    c.style.setProperty("--ty",(cy+R*Math.sin(a)-oy).toFixed(1)+"px");
    c.style.setProperty("--mx",(cx-ox).toFixed(1)+"px");
    c.style.setProperty("--my",(cy-oy).toFixed(1)+"px");
    c.style.setProperty("--dl",(i*55)+"ms");
  });
}

/* بررسی کد + انیمیشن
   ⚠ عدد ۲۱۵۰ باید با مدت otpSpin و تعداد دورها در styles.css هماهنگ بماند */
async function otpVerify(){
  if(otpBusy||!otpCtx)return;
  const inp=document.getElementById("otpInput");
  const code=inp.value.replace(/\D/g,"");
  if(code.length<5){otpErr("کد ۵ رقمی را کامل وارد کنید");return;}

  otpBusy=true;otpErr("");
  const stage=document.getElementById("otpStage"),btn=document.getElementById("otpBtn");
  btn.disabled=true;btn.textContent="در حال بررسی…";
  inp.blur();otpRender();
  otpLayout();
  stage.classList.remove("bad");stage.classList.add("spin");

  const [res]=await Promise.allSettled([
    api("POST","/auth/otp/verify",{purpose:otpCtx.purpose,phone:otpCtx.phone,code}),
    otpWait(2150),
  ]);

  if(res.status==="rejected"){
    stage.classList.remove("spin");
    void stage.offsetWidth;                 /* ری‌فلو تا انیمیشن لرزش دوباره اجرا شود */
    stage.classList.add("bad");
    setTimeout(()=>stage.classList.remove("bad"),700);
    otpErr(res.reason.message);
    otpBusy=false;btn.disabled=false;btn.textContent="تایید و ادامه";
    inp.focus();inp.select();otpRender();
    return;
  }

  /* ادغام در مرکز → تیک سبز */
  stage.classList.add("merge");
  await otpWait(430);
  stage.classList.add("done");
  await otpWait(950);

  otpStopTimer();
  const d=res.value;
  if(otpCtx.purpose==="reset"){
    otpCtx.resetToken=d.resetToken;
    otpBusy=false;btn.textContent="تایید و ادامه";
    swA("newpass");
  }else{
    otpBusy=false;btn.textContent="تایید و ادامه";
    authDone(d,"حساب شما ساخته شد — خوش آمدید");
  }
}

function doLogout(){token=null;me=null;localStorage.removeItem("tb_tk");localStorage.removeItem("tb_me");syncAuthCookie();renderNav();go("home");toast("خروج موفق","nfo");}

/* CART */
function saveCart(){localStorage.setItem("tb_cart",JSON.stringify(cart));}
function isInCart(id){return cart.some(x=>x.id===id);}

/* Fix 2: addToCartBtn — updates only the specific button, no full grid re-render */
function addToCartBtn(id,btn){
  const p=allProds.find(x=>x.id===id);if(!p)return;
  if(isInCart(id)){toast("قبلاً در سبد است","nfo");openCart();return;}
  const disc=p.discount?Math.round(p.price*(1-p.discount/100)):p.price;
  cart.push({id,title:p.title,price:disc,type:p.type});
  saveCart();updateCartBadge(true);flyToCart(btn,p);
  /* Update all instances of this product's cart button without re-rendering cards */
  document.querySelectorAll(`#cadd-${id}`).forEach(b=>{b.innerHTML=ic("check",14)+" سبد";b.classList.add("in-cart");});
}
/* Keep old addToCart for detail page */
function addToCart(id,btn){addToCartBtn(id,btn);}
function removeFromCart(id){cart=cart.filter(x=>x.id!==id);saveCart();updateCartBadge();renderCartBody();}
function updateCartBadge(animate){
  const cc=document.getElementById("cartCount");
  if(cc){cc.textContent=cart.length;cc.classList.toggle("show",cart.length>0);}
  /* Only bounce the icon when explicitly told to (i.e. user added an item).
     Never animate on page load / navigation. */
  if(animate){
    const btn=document.getElementById("cartBtn");
    if(btn){btn.classList.add("bounce");setTimeout(()=>btn.classList.remove("bounce"),500);}
  }
}
function openCart(){renderCartBody();document.getElementById("cartOvl").classList.add("open");document.getElementById("cartBd").classList.add("show");}
function closeCart(){document.getElementById("cartOvl").classList.remove("open");document.getElementById("cartBd").classList.remove("show");}
function renderCartBody(){
  const body=document.getElementById("cartBody"),ft=document.getElementById("cartFt");
  if(!cart.length){body.innerHTML=`<div class="cart-empty"><div class="cart-empty-ico">${ic('cart',16)}</div><p>سبد خرید خالی است</p><button class="cta-b" style="margin-top:1rem;font-size:13px" onclick="go('shop')">مشاهده محصولات</button></div>`;ft.style.display="none";return;}
  body.innerHTML=cart.map(it=>`<div class="cart-item"><div class="ci-ico">${ic(TI[it.type]||"file-text",16)}</div><div class="ci-info"><div class="ci-nm">${it.title}</div><div class="ci-pr">${it.price.toLocaleString()} تومان</div></div><button class="ci-del" onclick="removeFromCart('${it.id}')">×</button></div>`).join("");
  const tot=cart.reduce((s,x)=>s+x.price,0);
  document.getElementById("cartTot").textContent=tot.toLocaleString()+" تومان";
  ft.style.display="block";
}
function goCheckout(){closeCart();go("checkout");}
function renderCheckout(){
  const itms=document.getElementById("choItems");
  if(!cart.length){itms.innerHTML=`<div class="empty" style="padding:2rem"><div class="empty-i">${ic('cart',16)}</div><p>سبد خالی است</p></div>`;return;}
  itms.innerHTML=cart.map(it=>`<div class="cho-row"><div class="cho-ico">${ic(TI[it.type]||"file-text",16)}</div><div class="cho-nm">${it.title}</div><div class="cho-pr">${it.price.toLocaleString()} ت</div></div>`).join("");
  const tot=cart.reduce((s,x)=>s+x.price,0);
  document.getElementById("choSum").innerHTML=`<div class="cs-row"><span>تعداد محصولات</span><span>${cart.length} مورد</span></div><div class="cs-row"><span>جمع</span><span>${tot.toLocaleString()} تومان</span></div><div class="cs-row"><span>مالیات</span><span>رایگان</span></div><div class="cs-row total"><span>مبلغ نهایی</span><span>${tot.toLocaleString()} تومان</span></div>`;
}
async function payCart(){
  if(!me){pendBuy="__cart__";openAuth("login");toast("برای پرداخت وارد شوید","nfo");return;}
  if(!cart.length){toast("سبد خالی است","err");return;}
  /* Feature 1: require terms acceptance before finalizing the purchase */
  if(!me.termsAccepted){
    openLegalModal();
    return;
  }
  doCheckoutPayment();
}

/* Runs the actual payment loop (called after terms are accepted) */
async function doCheckoutPayment(){
  const btn=document.getElementById("choPayBtn");
  if(btn){btn.disabled=true;btn.textContent="در حال پردازش...";}
  let paid=0;
  for(const it of cart){
    try{
      const o=await api("POST","/orders/create",{productId:it.id});
      await api("POST",`/orders/pay/${o.orderId}`);
      if(!me.purchases)me.purchases=[];
      me.purchases.push(it.id);paid++;
    }catch{}
  }
  localStorage.setItem("tb_me",JSON.stringify(me));
  cart=[];saveCart();updateCartBadge();
  if(btn){btn.disabled=false;btn.textContent="پرداخت و دانلود همه موارد";}
  if(paid>0){toast(`${ic('check',16)} ${paid} محصول خریداری شد!`,"ok");setTimeout(()=>go("dash"),1200);}
  else toast("خطا در پرداخت","err");
}

/* ─── LEGAL ACCEPTANCE MODAL ─── */
function openLegalModal(){
  const ov=document.getElementById("legalOvl");
  if(ov){ov.classList.add("on");if(typeof hydrateIcons==="function")hydrateIcons(ov);}
}
async function acceptTerms(){
  const btn=document.getElementById("legalAcceptBtn");
  if(btn){btn.disabled=true;btn.textContent="در حال ثبت…";}
  try{
    const r=await api("POST","/terms/accept",{});
    if(me){me.termsAccepted=true;me.termsAcceptedAt=r.termsAcceptedAt;localStorage.setItem("tb_me",JSON.stringify(me));}
    closeOvl("legalOvl");
    toast("قوانین پذیرفته شد","ok");
    /* continue the purchase the user was making */
    if(cart.length)doCheckoutPayment();
  }catch(e){
    toast(e.message||"خطا در ثبت","err");
  }finally{
    if(btn){btn.disabled=false;btn.innerHTML=ic("check",16)+" پذیرش قوانین و ادامه";}
  }
}

/* ─── FILE DOWNLOAD WITH HEAVY-FILE PROGRESS ─── */
function fmtMB(bytes){
  const mb=bytes/1048576;
  return (mb>=10?Math.round(mb):mb.toFixed(1)).toLocaleString("fa-IR")+" MB";
}
function faPct(n){return Math.round(n).toLocaleString("fa-IR")+"٪";}

async function downloadProduct(productId,productTitle,downloadName){
  if(!token){toast("ابتدا وارد شوید","err");return;}
  const ov=document.getElementById("dlOvl");
  const fill=document.getElementById("dlFill");
  const elDone=document.getElementById("dlDone");
  const elRemain=document.getElementById("dlRemain");
  const elPct=document.getElementById("dlPct");
  const elTitle=document.getElementById("dlTitle");
  const elSub=document.getElementById("dlSub");
  const elFoot=document.getElementById("dlFoot");

  try{
    const resp=await fetch(API+"/download/"+encodeURIComponent(productId),{
      headers:{"Authorization":"Bearer "+token}
    });
    if(!resp.ok){
      let msg="خطا در دانلود";
      try{msg=(await resp.json()).error||msg;}catch{}
      toast(msg,"err");return;
    }
    const total=+(resp.headers.get("Content-Length")||0);
    const HEAVY=8*1048576; /* 8MB threshold → show progress modal */
    const reader=resp.body.getReader();
    const chunks=[];let received=0;

    /* Only pop the progress modal for heavy files */
    const heavy=total>HEAVY;
    if(heavy){
      elTitle.textContent="در حال دانلود فایل";
      elSub.textContent=productTitle||"فایل دیجیتال";
      elFoot.textContent="";
      fill.style.width="0%";
      elDone.textContent="۰ MB";elPct.textContent="۰٪";
      elRemain.textContent=fmtMB(total);
      ov.classList.add("on");
      if(typeof hydrateIcons==="function")hydrateIcons(ov);
    }else{
      toast("در حال دانلود…","nfo");
    }

    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      chunks.push(value);received+=value.length;
      if(heavy){
        const pct=total?received/total*100:0;
        fill.style.width=pct+"%";
        elDone.textContent=fmtMB(received);
        elRemain.textContent=fmtMB(Math.max(0,total-received));
        elPct.textContent=faPct(pct);
      }
    }

    /* assemble + trigger browser save.
       Fix 2: derive the filename from the server's Content-Disposition
       header so the ORIGINAL extension is preserved (.png/.zip/etc).
       Never hardcode .pdf. */
    let fname=downloadName||"";
    const cd=resp.headers.get("Content-Disposition")||"";
    const mStar=/filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
    const mPlain=/filename="?([^";]+)"?/i.exec(cd);
    if(mStar){try{fname=decodeURIComponent(mStar[1]);}catch{fname=mStar[1];}}
    else if(mPlain){try{fname=decodeURIComponent(mPlain[1]);}catch{fname=mPlain[1];}}
    if(!fname)fname=(productId||"file")+".dat";
    const blob=new Blob(chunks);
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=fname;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);

    if(heavy){
      fill.style.width="100%";
      elTitle.textContent="دانلود کامل شد";
      elSub.textContent="فایل با موفقیت ذخیره شد";
      elPct.textContent="۱۰۰٪";
      elFoot.innerHTML=`<button class="dl-close-btn" onclick="closeOvl('dlOvl')">${ic("check",15)} بستن</button>`;
      if(typeof hydrateIcons==="function")hydrateIcons(ov);
    }else{
      toast("دانلود انجام شد","ok");
    }
  }catch(e){
    toast("خطا در دانلود فایل","err");
    closeOvl("dlOvl");
  }
}

/* FLY-TO-CART */
function flyToCart(fromEl,p){
  const cb=document.getElementById("cartBtn");
  if(!fromEl||!cb)return;
  const sr=fromEl.getBoundingClientRect(),tr=cb.getBoundingClientRect();
  const fly=document.createElement("div");
  fly.className="fly-item";fly.textContent=TI[p.type]||"";
  fly.style.cssText=`top:${sr.top+sr.height/2-21}px;left:${sr.left+sr.width/2-21}px`;
  document.body.appendChild(fly);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    fly.classList.add("go");
    fly.style.top=(tr.top+tr.height/2-11)+"px";
    fly.style.left=(tr.left+tr.width/2-11)+"px";
    fly.style.transform="scale(.2)";fly.style.opacity="0";
    setTimeout(()=>{fly.remove();const b=document.getElementById("cartBtn");if(b){b.classList.add("shake");setTimeout(()=>b.classList.remove("shake"),400);}},570);
  }));
}

/* PRODUCTS */
async function loadProds(){
  try{allProds=await api("GET","/products");}catch{allProds=fallback();}
  /* Mock padding is a pagination-testing aid ONLY — opt-in via ?demo=1 (or
     localStorage tb_demo=1). By default the shop shows real products only,
     which also keeps the catalogue light on low-end devices. */
  let demo=false;
  try{demo=/[?&]demo=1\b/.test(location.search)||localStorage.getItem("tb_demo")==="1";}catch{}
  if(demo&&allProds.length<45)allProds=genMockProducts(allProds);
}
function fallback(){return[
  {id:"prod_full_book",type:"book",featured:true,title:"گرمابندی ساختمان — نسخه کامل",description:"۴۵۰ صفحه، ۱۲ فصل، ۳۰۰+ تصویر",price:285000,originalPrice:350000,rating:4.8,reviewCount:47,image:""},
  {id:"ch_01",type:"chapter",featured:true,chapterNum:1,title:"فصل ۱ — اصول عایق‌بندی",description:"مفاهیم پایه، ضوابط نظام مهندسی",price:45000,freePages:10,rating:4.9,reviewCount:23,qrPage:"ch_01_p1",image:""},
  {id:"ch_02",type:"chapter",chapterNum:2,title:"فصل ۲ — سیستم HVAC",description:"تحلیل و طراحی سیستم‌های حرارتی",price:45000,rating:4.7,reviewCount:18,qrPage:"ch_02_p1",image:""},
  {id:"ch_03",type:"chapter",featured:true,chapterNum:3,title:"فصل ۳ — دیوارهای مرکب",description:"ETICS و رویه‌های اجرایی",price:45000,rating:4.6,reviewCount:31,qrPage:"ch_03_p1",image:""},
  {id:"ch_04",type:"chapter",chapterNum:4,title:"فصل ۴ — بخار بند",description:"کنترل رطوبت، کندانسیشن",price:45000,rating:4.8,reviewCount:15,image:""},
  {id:"ch_05",type:"chapter",chapterNum:5,title:"فصل ۵ — سقف‌ها",description:"جزئیات اجرایی، waterproofing",price:45000,rating:4.5,reviewCount:12,image:""},
  {id:"ch_06",type:"chapter",chapterNum:6,title:"فصل ۶ — پنجره‌ها",description:"دوجداره، سه‌جداره، ضریب U",price:45000,rating:4.7,reviewCount:9,image:""},
  {id:"ch_07",type:"chapter",chapterNum:7,title:"فصل ۷ — کف و زیرزمین",description:"عایق‌بندی کف و دیوارهای زیرزمینی",price:45000,rating:4.4,reviewCount:7,image:""},
  {id:"ch_08",type:"chapter",chapterNum:8,title:"فصل ۸ — پل حرارتی",description:"شناسایی و رفع پل‌های حرارتی",price:45000,rating:4.9,reviewCount:11,image:""},
  {id:"ch_09",type:"chapter",chapterNum:9,title:"فصل ۹ — پوشش‌های رنگی",description:"رنگ‌های عایق و روکش‌های حرارتی",price:45000,rating:4.3,reviewCount:6,image:""},
  {id:"ch_10",type:"chapter",chapterNum:10,title:"فصل ۱۰ — محاسبات انرژی",description:"نرم‌افزارهای انرژی، استانداردها",price:45000,rating:4.6,reviewCount:14,image:""},
  {id:"detail_D01C163",type:"image",featured:true,title:"دتایل D01C163",description:"سکشن اجرایی DWG+PDF",price:18000,rating:4.9,reviewCount:8,qrPage:"detail_D01C163",image:""},
  {id:"detail_D02",type:"image",title:"دتایل D02 — سقف مسطح",description:"پلان اجرایی سقف",price:18000,rating:4.6,reviewCount:5,image:""},
  {id:"detail_D03",type:"image",title:"دتایل D03 — پنجره",description:"اتصال پنجره دوجداره",price:18000,rating:4.7,reviewCount:4,image:""},
  {id:"art_condensation",type:"article",featured:true,title:"راه‌حل کندانسیشن",description:"بررسی کامل کندانس",price:8000,rating:4.8,reviewCount:21,image:""},
  {id:"art_coldwall",type:"article",title:"دیوار شمالی سرد",description:"دلایل فنی و راه‌حل",price:8000,rating:4.5,reviewCount:14,image:""},
  {id:"art_uvalue",type:"article",title:"محاسبه ضریب U",description:"راهنمای عملی",price:8000,rating:4.7,reviewCount:19,image:""},
  {id:"art_hvac",type:"article",title:"انتخاب سیستم گرمایشی",description:"مقایسه رادیاتور، فن‌کویل",price:8000,rating:4.6,reviewCount:16,image:""},
];}

/* ─── MOCK PRODUCT GENERATOR ───
   Pads the catalog up to 45 items so the pagination system can be tested
   (PER_PAGE=15 → 3 full pages). Mock items are clearly synthetic. */
function genMockProducts(existing){
  const out=[...existing];
  const types=["chapter","image","article","book"];
  const topics=[
    "عایق‌بندی پشت‌بام","کنترل پل حرارتی","سیستم گرمایش از کف","پنجره سه‌جداره",
    "دیوار ترومب","تهویه مطبوع مرکزی","عایق صوتی و حرارتی","نمای دوپوسته",
    "سقف سبز","بازیافت حرارت","پمپ حرارتی زمین‌گرمایی","شیشه Low-E",
    "درزبندی نوین","عایق نانو","سیستم ETICS پیشرفته","محاسبه بار حرارتی",
    "گواهی انرژی ساختمان","پدافند رطوبتی","کفپوش عایق","سایه‌بان هوشمند",
    "دیوار فاز متغیر","بام کاهگلی مدرن","عایق سلولزی","فوم پلی‌اورتان",
    "مدل‌سازی انرژی"
  ];
  let i=0;
  while(out.length<45){
    const t=types[i%types.length];
    const topic=topics[i%topics.length];
    const price=[8000,18000,45000,120000][i%4];
    out.push({
      id:"mock_"+(i+1),
      type:t,
      title:topic+" — راهنمای "+(i+1),
      description:"محتوای آزمایشی برای تست صفحه‌بندی فروشگاه",
      price:price,
      rating:Math.round((3.8+(i%12)*0.1)*10)/10,
      reviewCount:3+(i*7)%40,
      image:"",
      mock:true
    });
    i++;
  }
  return out;
}

function mkSt(r,sm=false){const v=Math.round(r||0),sz=sm?11:14;let s="";for(let i=1;i<=5;i++){const on=i<=v;s+=`<span class="${sm?"ri-s":"stx"} ${on?"on":"off"}">${on?icf('star',sz):ic('star',sz)}</span>`;}return s;}

function imgHTML(p,h=152){
  const hStyle=h>0?`height:${h}px`:`height:100%;aspect-ratio:4/3`;
  /* loading=lazy + decoding=async keep the grid smooth with many images;
     async decode means image work never blocks the main thread. */
  if(p.image&&p.image.length>10)return`<div class="pc-img" style="${hStyle}"><img src="${p.image}" alt="" draggable="false" oncontextmenu="return false" loading="lazy" decoding="async"><div class="pc-img-wm"><span>THERMAL ENG • PROTECTED •</span></div><div class="pc-lock">${ic('lock',16)}</div></div>`;
  /* placeholder colour is driven by CSS (data-ptype) so a theme switch
     needs zero DOM rebuild — pure CSS repaint. */
  return`<div class="pc-img-ph" data-ptype="${p.type||'article'}" style="${hStyle}"><span class="pc-img-ph-ico">${ic(TI[p.type]||"file-text",16)}</span><div class="pc-img-wm"><span>THERMAL ENG • PROTECTED •</span></div><div class="pc-lock">${ic('lock',16)}</div></div>`;
}

/* یک شکل کارت بیشتر وجود ندارد — نمای لیستی حذف شده است. */
function prodCard(p){
  const disc=p.discount?Math.round(p.price*(1-p.discount/100)):p.price;
  const rt=p.rating?`<div class="pc-rt">${mkSt(p.rating,true)}<span>(${p.reviewCount||0})</span></div>`:"";
  const inC=isInCart(p.id);
  const img=imgHTML(p,152);
  const pid=p.id;
  /* Fix 2: use data-pid attribute to avoid closure issues; stopPropagation not enough — use separate flag */
  return`<div class="pc" data-pid="${pid}" onclick="openDetail('${pid}')">
    ${img}
    <div class="pc-body">
      <span class="pc-bdg ${TC[p.type]||"art-b"}">${ic(TI[p.type]||"file-text",16)} ${TL[p.type]||p.type}</span>
      <div class="pc-nm">${p.title}</div>
      <div class="pc-ds">${p.description||""}</div>
      <div class="pc-ft">
        <div style="display:flex;flex-direction:column;gap:3px"><span class="pc-pr">${disc.toLocaleString()} ت</span>${rt}</div>
        <div class="pc-btn-grp">
          <button class="buy-b" onclick="(function(e){e.stopPropagation();e.preventDefault();buyProduct('${pid}');})(event)">خرید</button>
          <button class="cart-add-b ${inC?"in-cart":""}" id="cadd-${pid}" onclick="(function(e){e.stopPropagation();e.preventDefault();addToCartBtn('${pid}',this);})(event)">${inC?" سبد":"+ سبد"}</button>
        </div>
      </div>
    </div></div>`;
}

function renderFeatured(){const el=document.getElementById("homeFeatured");if(el)el.innerHTML=allProds.filter(p=>p.featured).slice(0,6).map(p=>prodCard(p)).join("");}

/* SHOP + PAGINATION */
let sfQ="";
function setSFType(btn,t){document.querySelectorAll("#sfBtns .sf-b").forEach(b=>b.classList.remove("on"));btn.classList.add("on");sfType=t;curPage=1;renderShop();}
/* setV() حذف شد — فروشگاه فقط نمای شبکه‌ای دارد.
   اگر جایی از کد قدیمی هنوز صدایش بزند، خطا ندهد: */
function setV(){}
function getFiltered(){
  const sort=(document.getElementById("sfSort")||{}).value||"default";
  let p=[...allProds];
  if(sfType&&sfType!=="all")p=p.filter(x=>x.type===sfType);
  if(sfQ)p=p.filter(x=>x.title.includes(sfQ)||x.description?.includes(sfQ)||x.tags?.some(t=>t.includes(sfQ)));
  if(sort==="price-asc")p.sort((a,b)=>a.price-b.price);
  else if(sort==="price-desc")p.sort((a,b)=>b.price-a.price);
  else if(sort==="rating")p.sort((a,b)=>(b.rating||0)-(a.rating||0));
  return p;
}
function renderShop(){
  filteredProds=getFiltered();
  const total=filteredProds.length,totalPg=Math.ceil(total/PER_PAGE)||1;
  curPage=Math.max(1,Math.min(curPage,totalPg));
  const start=(curPage-1)*PER_PAGE;
  const page=filteredProds.slice(start,start+PER_PAGE);
  const st=document.getElementById("shopStats");if(st)st.textContent=`${total} محصول • صفحه ${curPage}/${totalPg}`;
  const grid=document.getElementById("prodGrid");if(!grid)return;
  grid.className="pg-grid";
  grid.innerHTML=page.length?page.map(x=>prodCard(x)).join(""):`<div class="empty" style="grid-column:1/-1"><div class="empty-i">${ic('search',16)}</div><p>محصولی یافت نشد</p></div>`;
  renderPgn(totalPg);
}
function renderPgn(tp){
  const el=document.getElementById("pgn");if(!el)return;
  if(tp<=1){el.innerHTML="";return;}
  let range=[];
  if(tp<=7)for(let i=1;i<=tp;i++)range.push(i);
  else{range.push(1);if(curPage>3)range.push("...");const s=Math.max(2,curPage-1),e=Math.min(tp-1,curPage+1);for(let i=s;i<=e;i++)range.push(i);if(curPage<tp-2)range.push("...");range.push(tp);}
  el.innerHTML=
    `<button class="pgn-b ${curPage===1?"dis":""}" onclick="gPg(${curPage-1})">›</button>`+
    range.map(r=>r==="..."?`<span class="pgn-dots">…</span>`:`<button class="pgn-b ${r===curPage?"on":""}" onclick="gPg(${r})">${r}</button>`).join("")+
    `<button class="pgn-b ${curPage===tp?"dis":""}" onclick="gPg(${curPage+1})">‹</button>`;
}
function gPg(p){curPage=p;renderShop();const sp=document.querySelector(".shop-pg");if(sp)sp.scrollIntoView({behavior:"smooth",block:"start"});}

/* INTEGRATED SEARCH */
function setISM(m){isMode=m;document.getElementById("isG").classList.toggle("on",m==="g");document.getElementById("isAI").classList.toggle("on",m==="ai");document.getElementById("isInp").placeholder=m==="ai"?"مشکل فنی را بپرس...":"جستجو در محصولات...";}
function qS(t){document.getElementById("isInp").value=t;doIS();}
function hideISRes(){document.getElementById("isRes").classList.remove("show");document.getElementById("aiStrip").classList.remove("show");}
function onISType(){
  clearTimeout(isTimer);
  isTimer=setTimeout(()=>{
    const q=document.getElementById("isInp").value.trim();
    if(q.length>=2&&isMode==="g"){sfQ=q;curPage=1;renderShop();showLocalIS(q);}
    else if(!q){sfQ="";curPage=1;renderShop();hideISRes();}
  },280);
}
function showLocalIS(q){
  const items=allProds.filter(p=>p.title.includes(q)||p.description?.includes(q)||p.tags?.some(t=>t.includes(q))).slice(0,6);
  if(!items.length){hideISRes();return;}
  document.getElementById("isResHd").textContent=`${items.length} نتیجه`;
  document.getElementById("isResItems").innerHTML=items.map(p=>`<div class="is-ri" onclick="openDetail('${p.id}')"><span class="is-ri-ico">${ic(TI[p.type]||"file-text",16)}</span><span class="is-ri-nm">${p.title}</span><span class="is-ri-pr">${(p.discount?Math.round(p.price*(1-p.discount/100)):p.price).toLocaleString()} ت</span></div>`).join("");
  document.getElementById("isRes").classList.add("show");
}
async function doIS(){
  const q=document.getElementById("isInp").value.trim();if(!q)return;
  sfQ=q;curPage=1;renderShop();
  if(isMode==="ai"){
    document.getElementById("aiAns").innerHTML=`<span style="color:var(--muted)">⏳ در حال تحلیل...</span>`;
    document.getElementById("aiStrip").classList.add("show");
    document.getElementById("isRes").classList.remove("show");
    try{
      const d=await api("POST","/search",{q,mode:"ai"});
      document.getElementById("aiAns").textContent=d.answer;
      document.getElementById("aiChips").innerHTML=(d.relatedProducts||[]).map(p=>`<button class="ai-chip" onclick="openDetail('${p.id}')">${ic(TI[p.type]||"file-text",16)} ${p.title}</button>`).join("");
    }catch(e){
      /* Fix 3: graceful AI error with clear user-friendly explanation */
      document.getElementById("aiAns").innerHTML=`<div style="display:flex;flex-direction:column;gap:.5rem">
        <div style="display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:var(--gold)"> سرویس AI موقتاً در دسترس نیست</div>
        <div style="font-size:12px;color:var(--muted);line-height:1.7">ارتباط با سرویس هوش مصنوعی (API کلود) برقرار نشد. این یک مشکل موقت سرور خارجی است — نه نقص در وبسایت.<br><span style="color:var(--faint);font-size:11px">جستجوی کلی پایین همچنان در دسترس است </span></div>
      </div>`;
      document.getElementById("aiChips").innerHTML="";
      /* Fall back to local search results */
      showLocalIS(q);
    }
  }else showLocalIS(q);
}

/* DETAIL */
function openDetail(id){const p=allProds.find(x=>x.id===id);if(!p)return;go("detail",p);}
async function renderDetail(p){
  const disc=p.discount?Math.round(p.price*(1-p.discount/100)):p.price,saved=p.discount?p.price-disc:0;
  const dark=isDark();const bg=dark?(BGD[p.type]||"#12192a"):(BGL[p.type]||"#dde0e6");
  const vis=p.image&&p.image.length>10?`<img style="width:100%;height:100%;object-fit:cover;filter:blur(14px) brightness(.5) saturate(.7);transform:scale(1.08);pointer-events:none;user-select:none;position:absolute;inset:0" src="${p.image}" alt="" loading="lazy">`:`<div style="position:absolute;inset:0;background:${bg}"></div>`;
  document.getElementById("dtGrid").innerHTML=`<div class="dt-media">
    <div class="dt-vis">${vis}
      <div class="dt-vis-lock" style="z-index:3"><div class="ico">${ic(TI[p.type]||"file-text",16)}</div><span> محتوای محافظت‌شده</span><span style="font-size:11px;color:rgba(255,255,255,.3)">پس از خرید</span></div>
      <div class="dt-wm"><div class="dt-wm-row"><span>THERMAL ENGINEERING</span><span>THERMAL ENGINEERING</span></div><div class="dt-wm-row"><span>PROTECTED CONTENT</span><span>PROTECTED CONTENT</span></div></div>
      <div class="dt-secure"> محافظت‌شده</div></div>
  </div>
  <div class="dt-info">
    <div class="dt-ey">${TL[p.type]||p.type} — نظام مهندسی ایران</div>
    <h1 class="dt-title">${p.title}</h1>
    <div class="dt-strs">${mkSt(p.rating)}<span class="dt-rn">${p.rating||0}</span><span class="dt-rc">(${p.reviewCount||0} نظر)</span></div>
    ${p.description?`<p class="dt-lead">${escHtml(p.description)}</p>`:""}
    <div class="dt-pb"><div class="dp-row"><span class="dp-new">${disc.toLocaleString()}</span><span class="dp-unit">تومان</span>${p.originalPrice?`<span class="dp-old">${p.originalPrice.toLocaleString()}</span>`:""} ${saved?`<span class="dp-disc">-${p.discount}٪</span>`:""}</div>${saved?`<div style="font-size:11.5px;color:var(--green);margin-top:.4rem">صرفه‌جویی: ${saved.toLocaleString()} تومان</div>`:""}</div>
    <div class="dt-acts">
      <button class="da-buy" onclick="buyProduct('${p.id}')"> خرید مستقیم</button>
      <button class="da-cart" onclick="addToCart('${p.id}',this)" title="افزودن به سبد"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg></button>
      <button class="da-shr" onclick="navigator.share?navigator.share({title:'${p.title}',url:location.href}):toast('کپی شد','nfo')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
    </div>
    <div class="dt-trust">
      <span class="dt-trust-i">${ic('shield-lock',15)} پرداخت امن</span>
      <span class="dt-trust-i">${ic('download',15)} دانلود فوری</span>
      <span class="dt-trust-i">${ic('check-circle',15)} دسترسی دائمی</span>
    </div>
    <div class="dt-specs">
      ${p.pages?`<div class="sp-row"><span class="sp-l">صفحات</span><span class="sp-v">${p.pages} صفحه</span></div>`:""}
      ${p.chapterNum?`<div class="sp-row"><span class="sp-l">فصل</span><span class="sp-v">فصل ${p.chapterNum}</span></div>`:""}
      ${p.freePages?`<div class="sp-row"><span class="sp-l">پیش‌نمایش رایگان</span><span class="sp-v" style="color:var(--green)">${p.freePages} صفحه</span></div>`:""}
      <div class="sp-row"><span class="sp-l">فرمت</span><span class="sp-v">PDF</span></div>
      <div class="sp-row"><span class="sp-l">دسترسی</span><span class="sp-v" style="color:var(--green)">فوری پس از خرید</span></div>
    </div>
    ${p.tags&&p.tags.length?`<div class="dt-tags">${p.tags.map(t=>`<span class="dtg">${escHtml(t)}</span>`).join("")}</div>`:""}
  </div>`;
  renderDetailRecs(p);
  await renderRevs(p.id);
}

/* ─── Feature 2: horizontal recommendations carousel on detail page ─── */
function renderDetailRecs(current){
  const el=document.getElementById("dtRecs");
  if(!el)return;
  /* pick other products, prefer same type, then shared tags */
  const others=allProds.filter(p=>p.id!==current.id);
  const tags=current.tags||[];
  const scored=others.map(p=>{
    let s=0;
    if(p.type===current.type)s+=2;
    s+=(p.tags||[]).filter(t=>tags.includes(t)).length;
    return {p,s};
  }).sort((a,b)=>b.s-a.s);
  const recs=scored.slice(0,10).map(x=>x.p);
  if(!recs.length){el.innerHTML="";return;}
  el.innerHTML=`
    <div class="dt-recs-hd">
      <h3>${ic('spark',16)} محصولات پیشنهادی</h3>
      <span class="dt-recs-hint">${ic('arrow-left',13)} بکشید</span>
    </div>
    <div class="dt-recs-row">
      ${recs.map(p=>{
        const disc=p.discount?Math.round(p.price*(1-p.discount/100)):p.price;
        return `<div class="dt-rec-card" onclick="go('detail',${JSON.stringify(p).replace(/"/g,'&quot;')})">
          <div class="dt-rec-ico">${ic(TI[p.type]||"file-text",22)}</div>
          <div class="dt-rec-body">
            <div class="dt-rec-type">${TL[p.type]||p.type}</div>
            <div class="dt-rec-nm">${p.title}</div>
            <div class="dt-rec-pr">${disc.toLocaleString()} تومان</div>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  if(typeof hydrateIcons==="function")hydrateIcons(el);
}

async function renderRevs(pid){
  const sec=document.getElementById("revSec");let revs=[];try{revs=await api("GET",`/reviews/${pid}`);}catch{}
  const wb=me?`<div class="rev-write"><h4>نظر خود را بنویسید</h4><div class="star-sel" id="starSel">${[1,2,3,4,5].map(i=>`<span class="ss-star" data-i="${i}" onclick="selStar(${i})">${ic('star',20)}</span>`).join("")}</div><textarea class="rev-ta" id="revTA" placeholder="نظر..."></textarea><button class="rev-sub" onclick="subRev('${pid}')">ثبت نظر</button></div>`:`<div class="rev-gate">برای ثبت نظر، <span onclick="openAuth('login')">وارد شوید</span>.</div>`;
  const rl=revs.length?revs.map(r=>{const init=r.userName?r.userName.split(" ").map(w=>w[0]).join("").substring(0,2):"?";const adminReply=r.adminReply?`<div class="ri-reply"><div class="ri-reply-hd">${ic('check-circle',13)} پاسخ مدیریت</div><div class="ri-reply-txt">${escHtml(r.adminReply)}</div></div>`:"";return`<div class="rev-item"><div class="ri-top"><div class="ri-av">${init}</div><div><div class="ri-nm">${r.userName}</div><div class="ri-dt">${new Date(r.createdAt).toLocaleDateString("fa-IR")}</div></div><div class="ri-strs">${mkSt(r.rating,true)}</div></div><div class="ri-txt">${r.text}</div>${adminReply}</div>`;}).join(""):`<div style="color:var(--faint);font-size:13px;text-align:center;padding:1.5rem 0">هنوز نظری ثبت نشده.</div>`;
  sec.innerHTML=`<h3>${ic('message',16)} نظرات (${revs.length})</h3>${wb}${rl}`;selRating=0;
}
function selStar(n){
  selRating=n;
  document.querySelectorAll("#starSel .ss-star").forEach((s,i)=>{
    const on=i<n;
    s.classList.toggle("on",on);
    /* swap between filled and outline star SVG */
    s.innerHTML=on?icf('star',20):ic('star',20);
  });
}
async function subRev(pid){if(!selRating){toast("امتیاز را انتخاب کنید","err");return;}const text=document.getElementById("revTA")?.value?.trim();if(!text||text.length<5){toast("حداقل ۵ کاراکتر","err");return;}try{await api("POST",`/reviews/${pid}`,{text,rating:selRating});toast("نظر ثبت شد","ok");await renderRevs(pid);}catch(e){toast(e.message,"err");}}

/* BUY DIRECT */
function buyProduct(id){if(!me){pendBuy=id;openAuth("login");toast("برای خرید وارد شوید","nfo");return;}const p=allProds.find(x=>x.id===id);if(!p)return;if(me.purchases?.includes(id)){toast("قبلاً خریده‌اید ","nfo");return;}const disc=p.discount?Math.round(p.price*(1-p.discount/100)):p.price;document.getElementById("buyTit").textContent=p.title;document.getElementById("buyDs").textContent=p.description||"";document.getElementById("buyPr").textContent=disc.toLocaleString();document.getElementById("buyOvl").dataset.pid=id;document.getElementById("buyOvl").classList.add("on");}
async function doPay(){const pid=document.getElementById("buyOvl").dataset.pid;const btn=document.getElementById("btnBuy");btn.disabled=true;btn.textContent="...";try{const o=await api("POST","/orders/create",{productId:pid});await api("POST",`/orders/pay/${o.orderId}`);if(!me.purchases)me.purchases=[];me.purchases.push(pid);localStorage.setItem("tb_me",JSON.stringify(me));closeOvl("buyOvl");toast("خرید موفق!","ok");}catch(e){toast(e.message,"err");}finally{btn.disabled=false;btn.textContent="پرداخت و دانلود";}}

/* QR — SIMPLIFIED
   ───────────────────────────────────────────────────────────
   The scanner accepts ANY QR content (no validation at scan time).
   extractQRCode() pulls a meaningful identifier out of whatever was
   scanned — for a URL it takes the last path segment, e.g.
       www.garmabandi.ir/DetailwallD01W111  →  DetailwallD01W111
   A bare code is used as-is. The extracted value is ALWAYS placed in
   the search box (even when nothing matches), then we search/filter
   products by it. */
function extractQRCode(raw){
  let v=(raw||"").trim();
  if(!v)return "";
  /* scheme://host[:port]/path...  OR  host.tld/path...  → keep the path tail */
  const m=/^(?:[a-z][a-z0-9+.\-]*:\/\/)?(?:www\.)?[a-z0-9.\-]+\.[a-z]{2,}(?::\d+)?(?:\/(.*))?$/i.exec(v);
  if(m){
    let path=(m[1]||"").split(/[?#]/)[0].replace(/\/+$/,"");
    const segs=path.split("/").filter(Boolean);
    if(segs.length)v=segs[segs.length-1];           /* last meaningful segment */
    else if(path)v=path;                              /* domain only → leave path */
    /* if it was a bare domain with no path, fall through with original */
  }
  try{v=decodeURIComponent(v);}catch{}
  return v.trim();
}
/* best-effort local product match by id / qrPage / qrCode / title */
function qrLocalMatches(code){
  if(!code)return [];
  const q=code.toLowerCase();
  return (allProds||[]).filter(p=>{
    return (p.id&&String(p.id).toLowerCase().includes(q))
      ||(p.qrPage&&String(p.qrPage).toLowerCase().includes(q))
      ||(p.qrCode&&String(p.qrCode).toLowerCase().includes(q))
      ||(p.title&&p.title.toLowerCase().includes(q));
  }).slice(0,6);
}
async function lkQR(){
  const inp=document.getElementById("qrInp");
  if(!inp)return;
  /* normalize whatever is in the box into a searchable identifier */
  const code=extractQRCode(inp.value);
  inp.value=code;                                     /* ALWAYS show the value */
  const res=document.getElementById("qrRes");
  if(!res)return;
  if(!code){res.innerHTML="";return;}
  res.innerHTML=`<div style="color:var(--muted);font-size:13px">${ic('search',16)} جستجو...</div>`;
  /* 1) exact QR lookup on the server (qrPage / id) */
  let found=null;
  try{const d=await api("GET",`/qr/${encodeURIComponent(code)}`);if(d&&d.found)found=d;}catch{}
  if(found){
    res.innerHTML=`<div class="qr-ok"><div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:.4rem">${ic('check',16)} یافت شد</div><div style="font-size:14px;font-weight:800;margin-bottom:.5rem">${escHtml(found.title)}</div><div style="font-size:13px;color:var(--goldL);margin-bottom:.75rem">${(found.price||0).toLocaleString()} تومان</div><button onclick="openDetail('${found.productId}')" class="cta-a" style="font-size:13px;padding:9px 18px">مشاهده و خرید</button></div>`;
    return;
  }
  /* 2) fall back to a local fuzzy search across the catalogue */
  const matches=qrLocalMatches(code);
  if(matches.length){
    res.innerHTML=`<div class="qr-ok"><div style="font-size:12.5px;font-weight:700;color:var(--muted);margin-bottom:.6rem">${matches.length} نتیجه برای «${escHtml(code)}»</div>`+
      matches.map(p=>{const disc=p.discount?Math.round(p.price*(1-p.discount/100)):p.price;return `<div class="is-ri" onclick="openDetail('${p.id}')"><span class="is-ri-ico">${ic(TI[p.type]||"file-text",16)}</span><span class="is-ri-nm">${escHtml(p.title)}</span><span class="is-ri-pr">${disc.toLocaleString()} ت</span></div>`;}).join("")+
      `</div>`;
    return;
  }
  /* 3) nothing matched — keep the value visible, offer shop search */
  res.innerHTML=`<div class="qr-err">${ic('alert',16)} محصولی برای «${escHtml(code)}» یافت نشد<br><button class="cta-b" style="margin-top:.7rem;font-size:12px" onclick="qrToShop('${encodeURIComponent(code)}')">جستجو در فروشگاه</button></div>`;
}
/* hand the scanned value off to the shop's search box */
function qrToShop(enc){
  let code="";try{code=decodeURIComponent(enc);}catch{code=enc;}
  try{sessionStorage.setItem("tb_shop_q",code);}catch{}
  location.href="shop.html";
}
function tQR(c){document.getElementById("qrInp").value=c;lkQR();}

/* CAMERA — QR scanning via the html5-qrcode library (robust on iOS Safari,
   Android, Firefox and desktop). The ~375KB library is lazy-loaded ONLY when
   the camera is opened, so it never weighs down the initial page load. */
function camSetStat(msg){const el=document.getElementById("camStat");if(el)el.textContent=msg;}
function camShowFallback(){const el=document.getElementById("camFallback");if(el)el.classList.add("show");}
let _h5qPromise=null,h5qScanner=null;
function ensureHtml5Qrcode(){
  if(typeof Html5Qrcode!=="undefined")return Promise.resolve(true);
  if(_h5qPromise)return _h5qPromise;
  _h5qPromise=new Promise(resolve=>{
    const s=document.createElement("script");
    s.src="assets/html5-qrcode.min.js";s.async=true;
    s.onload=()=>resolve(true);
    s.onerror=()=>resolve(false);
    document.head.appendChild(s);
  });
  return _h5qPromise;
}
async function openCamera(){
  document.getElementById("camOvl").classList.add("on");
  document.getElementById("camFallback").classList.remove("show");
  camSetStat("در حال آماده‌سازی دوربین...");

  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    camSetStat("مرورگر شما از دوربین پشتیبانی نمی‌کند — کد را دستی وارد کنید");
    camShowFallback();return;
  }
  const ok=await ensureHtml5Qrcode();
  if(!ok||typeof Html5Qrcode==="undefined"){
    camSetStat("بارگذاری اسکنر ناموفق بود — کد را دستی وارد کنید");
    camShowFallback();return;
  }
  const reader=document.getElementById("qrReader");
  if(!reader){camSetStat("خطای داخلی اسکنر");camShowFallback();return;}

  /* dispose any previous instance, then start fresh */
  if(h5qScanner){try{await h5qScanner.stop();}catch{}try{h5qScanner.clear();}catch{}h5qScanner=null;}
  reader.innerHTML="";
  h5qScanner=new Html5Qrcode("qrReader",{verbose:false});

  const onScan=(decoded)=>{
    if(!h5qScanner)return;                 /* guard against double-fire */
    const sc=h5qScanner;h5qScanner=null;
    sc.stop().then(()=>{try{sc.clear();}catch{}}).catch(()=>{}).finally(()=>{
      closeOvl("camOvl");
      routeFromQR(decoded);
    });
  };
  const config={fps:10,qrbox:{width:230,height:230},aspectRatio:1.0,rememberLastUsedCamera:true};
  try{
    await h5qScanner.start({facingMode:"environment"},config,onScan,()=>{/* per-frame decode miss — ignore */});
    camSetStat("QR را داخل کادر بگیرید…");
  }catch(e){
    const n=String((e&&(e.name||e.message))||e||"");
    let msg="دوربین در دسترس نیست";
    if(/NotAllowed|Permission|denied/i.test(n))msg="دسترسی به دوربین رد شد — از تنظیمات مرورگر اجازه دهید";
    else if(/NotFound|Overconstrained|no.*camera/i.test(n))msg="دوربینی روی این دستگاه پیدا نشد";
    else if(/NotReadable|in use|track start/i.test(n))msg="دوربین توسط برنامه دیگری اشغال شده است";
    else if(typeof window!=="undefined"&&window.isSecureContext===false)msg="دوربین فقط روی اتصال امن (HTTPS) کار می‌کند";
    h5qScanner=null;
    camSetStat(msg);camShowFallback();toast(msg,"err");
  }
}
function closeCamera(){
  if(h5qScanner){const sc=h5qScanner;h5qScanner=null;sc.stop().then(()=>{try{sc.clear();}catch{}}).catch(()=>{});}
  closeOvl("camOvl");
}
/* whatever was scanned/typed → extract a meaningful identifier → if it maps to
   a real product, INSTANTLY route to that book/chapter detail page; otherwise
   fall back to on-page search (value always shown in the box). */
async function routeFromQR(raw){
  const code=extractQRCode(raw);
  const inp=document.getElementById("qrInp");
  if(inp)inp.value=code;
  if(!code){toast("کدی خوانده نشد","err");return;}
  toast(" QR خوانده شد: "+code,"ok");
  try{
    const d=await api("GET","/qr/"+encodeURIComponent(code));
    if(d&&d.found){ location.href="detail.html?id="+encodeURIComponent(d.productId); return; }
  }catch{}
  await lkQR();   /* no exact match → search/filter by the value */
}
/* kept for backward compatibility with any external caller */
async function handleQRResult(code){closeCamera();await routeFromQR(code);}
function camManual(){const v=document.getElementById("camManInp").value.trim();if(!v){toast("کدی وارد نشده","err");return;}closeCamera();routeFromQR(v);}

/* DASH */
function showDV(v){
  document.querySelectorAll(".dv").forEach(x=>x.classList.remove("on"));
  document.querySelectorAll(".di").forEach(x=>x.classList.remove("on"));
  const dv=document.getElementById("dv"+v.charAt(0).toUpperCase()+v.slice(1));if(dv)dv.classList.add("on");
  const di=document.getElementById("di"+v.charAt(0).toUpperCase()+v.slice(1));if(di)di.classList.add("on");
  /* sync the mobile User-Panel tab bar */
  document.querySelectorAll("#dash-tab-bar .dtb").forEach(b=>b.classList.remove("active"));
  const dtb=document.getElementById("dtb-"+v);if(dtb)dtb.classList.add("active");
  /* lazy-load the support section the first time it opens */
  if(v==="sp"&&typeof loadSupport==="function")loadSupport();
}
/* Mobile User-Panel tab handler — scrolls to top after switching section */
function dashTab(v){showDV(v);window.scrollTo({top:0,behavior:"smooth"});}
async function loadDash(){
  if(!me){go("home");return;}
  const nm=me.firstName?(me.firstName+(me.lastName?" "+me.lastName:"")):me.phone;
  document.getElementById("dsAv").textContent=nm.slice(0,2).toUpperCase();
  /* desktop sidebar name */
  const nameEl=document.getElementById("dsName");
  if(nameEl)nameEl.textContent=nm;
  /* mobile profile header */
  const mAv=document.getElementById("dmpAv");if(mAv)mAv.textContent=nm.slice(0,2).toUpperCase();
  const mPh=document.getElementById("dmpPh");if(mPh)mPh.textContent=me.phone;
  const mRl=document.getElementById("dmpRl");if(mRl)mRl.textContent=me.isAdmin?"مدیر":"کاربر";
  const mName=document.getElementById("dmpName");
  if(mName){
    mName.textContent=nm;
    mName.classList.remove("marquee");
    /* اندازه‌گیری مطمئن: عرض طبیعی متن را با عرض کادر مقایسه کن */
    requestAnimationFrame(()=>{
      const wrap=mName.parentElement;
      /* عرض واقعی متن را با یک span موقت اندازه می‌گیریم */
      const probe=document.createElement("span");
      probe.style.cssText="position:absolute;visibility:hidden;white-space:nowrap;font-weight:800;font-size:14px;font-family:var(--f)";
      probe.textContent=nm;
      document.body.appendChild(probe);
      const textW=probe.offsetWidth;
      probe.remove();
      if(textW>wrap.clientWidth+4){
        mName.classList.add("marquee");
      }
    });
  }
  document.getElementById("dsPh").textContent=me.phone;
  document.getElementById("dsRl").textContent=me.isAdmin?"مدیر":"کاربر";
  document.getElementById("pfFn").value=me.firstName||"";document.getElementById("pfLn").value=me.lastName||"";
  document.getElementById("pfPh").value=me.phone;document.getElementById("pfCnt").textContent=(me.purchases||[]).length+" محصول";
  document.getElementById("pfDt").value=me.createdAt?new Date(me.createdAt).toLocaleDateString("fa-IR"):"—";
  try{let orders=await api("GET","/orders/my");
    /* Fix 3: ensure newest-first even for legacy orders */
    orders=[...orders].sort((a,b)=>new Date(b.paidAt||b.createdAt||0)-new Date(a.paidAt||a.createdAt||0));
    document.getElementById("pfCnt").textContent=orders.length+" محصول";const pl=document.getElementById("puList");
    if(!orders.length)pl.innerHTML=`<div class="empty"><div class="empty-i">${ic('package',16)}</div><p>هنوز خریدی نداشته‌اید<br><span style="color:var(--gold);cursor:pointer" onclick="go('shop')">به فروشگاه بروید</span></p></div>`;
    else{pl.innerHTML=orders.map(o=>`<div class="pi"><div class="pi-ico">${ic(TI[o.product?.type]||"file-text",16)}</div><div class="pi-inf"><div class="pi-nm">${o.product?.title||o.productTitle}</div><div class="pi-mt">${o.product?.description||""}</div><div class="pi-mt" style="color:var(--faint)">${o.paidAt?new Date(o.paidAt).toLocaleDateString("fa-IR"):""}</div></div><div class="pi-r"><span class="pi-st">${ic('check',16)} پرداخت شده</span><button class="pi-dl" onclick="downloadProduct('${o.productId}','${(o.product?.title||o.productTitle||'').replace(/'/g,'')}','${(o.product?.fileName||'').replace(/'/g,'')}')">${ic('download',16)} دانلود</button></div></div>`).join("");
      try{const recs=await api("GET","/recommendations");if(recs.length){document.getElementById("recsBoxW").style.display="block";document.getElementById("recsRow").innerHTML=recs.slice(0,6).map(p=>`<div class="rc"><div class="rc-ico">${ic(TI[p.type]||"file-text",16)}</div><div class="rc-nm">${p.title}</div><div class="rc-pr">${p.price.toLocaleString()} ت</div><button class="rc-b" onclick="buyProduct('${p.id}')">خرید</button></div>`).join("");}}catch{}}}
  catch(e){document.getElementById("puList").innerHTML=`<div class="empty"><div class="empty-i">${ic('alert',16)}</div><p>${e.message}</p></div>`;}
  try{const recs=await api("GET","/recommendations");document.getElementById("recsGrid").innerHTML=recs.length?recs.map(p=>prodCard(p)).join(""):`<div class="empty" style="grid-column:1/-1"><div class="empty-i">${ic('target',16)}</div><p>بعد از خرید اول نمایش داده می‌شود</p></div>`;}catch{}
}
async function savePro(){const fn=document.getElementById("pfFn").value.trim(),ln=document.getElementById("pfLn").value.trim();
  const nv=validateName(fn,ln);if(!nv.ok){toast(nv.msg,"err");return;}
  try{await api("PUT","/auth/profile",{firstName:fn,lastName:ln});me.firstName=fn;me.lastName=ln;localStorage.setItem("tb_me",JSON.stringify(me));renderNav();toast(" ذخیره شد","ok");}catch(e){toast(e.message,"err");}}

/* ─── SUPPORT TICKETS (user) ─── */
let spImageObj=null,spImageUrl="";
function spUpdateCount(){
  const ta=document.getElementById("spMessage");
  const el=document.getElementById("spCount");
  if(ta&&el)el.textContent=(ta.value.length).toLocaleString("fa-IR")+" / ۲۵۰";
}
function spHandleImg(e){
  const f=e.target.files[0];if(!f)return;
  if(!f.type.startsWith("image/")){toast("فقط فایل تصویری مجاز است","err");return;}
  if(f.size>50*1024*1024){toast("حجم تصویر بیش از ۵۰ مگابایت","err");return;}
  spImageObj=f;
  if(spImageUrl)URL.revokeObjectURL(spImageUrl);
  spImageUrl=URL.createObjectURL(f);
  document.getElementById("spFileThumb").src=spImageUrl;
  document.getElementById("spFileName").textContent=f.name;
  document.getElementById("spFilePh").style.display="none";
  document.getElementById("spFilePicked").style.display="flex";
}
function spClearImg(e){
  if(e)e.stopPropagation();
  spImageObj=null;
  if(spImageUrl){URL.revokeObjectURL(spImageUrl);spImageUrl="";}
  const inp=document.getElementById("spImage");if(inp)inp.value="";
  document.getElementById("spFilePh").style.display="flex";
  document.getElementById("spFilePicked").style.display="none";
}
/* status → {class,label}; labels differ for the user vs the admin side */
function tkStatusInfo(s,forAdmin){
  if(s==="answered")return{c:"tk-answered",l:"پاسخ داده شد"};
  if(s==="waiting") return{c:"tk-waiting", l:forAdmin?"در انتظار پاسخ مشتری":"در انتظار پاسخ شما"};
  if(s==="closed")  return{c:"tk-closed",  l:"بسته شده"};
  return{c:"tk-open",l:forAdmin?"در انتظار بررسی":"در انتظار پاسخ"};
}
let myTickets=[];
async function loadSupport(){
  /* pre-fill name + phone from the registered profile */
  if(me){
    const nm=((me.firstName||"")+" "+(me.lastName||"")).trim()||"کاربر";
    const eN=document.getElementById("spName"),eP=document.getElementById("spPhone");
    if(eN)eN.textContent=nm;
    if(eP)eP.textContent=me.phone||"—";
  }
  spUpdateCount();
  const list=document.getElementById("spList");
  if(!list)return;
  try{
    myTickets=await api("GET","/tickets/my");
    if(!myTickets.length){
      list.innerHTML=`<div class="empty"><div class="empty-i">${ic('message',16)}</div><p>هنوز تیکتی ثبت نکرده‌اید</p></div>`;
    }else{
      list.innerHTML=myTickets.map(t=>{
        const st=tkStatusInfo(t.status,false);
        const msgs=t.messages||[];
        const last=msgs.length?msgs[msgs.length-1]:null;
        const preview=last?(last.text||(last.image?"📎 تصویر":"")):"";
        const when=t.repliedAt||t.createdAt;
        return `<div class="tk-card" onclick="openTicketChat('${t.id}')">
          <div class="tk-card-main">
            <div class="tk-card-top">
              <span class="tk-card-subj">${escapeHtml(t.subject)}</span>
              <span class="tk-badge ${st.c}">${st.l}</span>
            </div>
            <div class="tk-card-preview">${last&&last.sender==="admin"?`<span class="tk-card-by">${ic('check-circle',12)} پشتیبانی:</span> `:""}${escapeHtml(preview).slice(0,90)}</div>
            <div class="tk-card-meta">${ic('message',12)} ${msgs.length} پیام · ${when?new Date(when).toLocaleDateString("fa-IR"):""}</div>
          </div>
          <div class="tk-card-arrow">${ic('arrow-left',18)}</div>
        </div>`;
      }).join("");
    }
  }catch(e){
    list.innerHTML=`<div class="empty"><div class="empty-i">${ic('alert',16)}</div><p>${e.message}</p></div>`;
  }
  if(typeof hydrateIcons==="function")hydrateIcons(list);
}

/* ─── Ticket chat (user side) ─── */
let tkChatId=null,tkChatImgObj=null,tkChatImgUrl="";
let tkChatPoll=null,tkChatSig="";
function stopTkChatPoll(){if(tkChatPoll){clearInterval(tkChatPoll);tkChatPoll=null;}}
function startTkChatPoll(id){
  stopTkChatPoll();
  tkChatPoll=setInterval(async()=>{
    const ov=document.getElementById("tkChatOvl");
    if(!ov||!ov.classList.contains("on")||tkChatId!==id){stopTkChatPoll();return;}
    try{
      const t=await api("GET","/tickets/"+encodeURIComponent(id));
      const sig=t.status+":"+(t.messages?t.messages.length:0);
      if(sig!==tkChatSig)renderTicketChat(t);   /* e.g. admin closed it → lock now */
    }catch{}
  },6000);
}
async function openTicketChat(id){
  tkChatId=id;
  const ov=document.getElementById("tkChatOvl");
  if(!ov)return;
  ov.classList.add("on");
  tkChatClearImg();
  const ta=document.getElementById("tkChatMsg");if(ta)ta.value="";
  const body=document.getElementById("tkChatBody");
  if(body)body.innerHTML=`<div class="tkchat-loading">${ic('clock',16)} در حال بارگذاری گفتگو…</div>`;
  try{
    const t=await api("GET","/tickets/"+encodeURIComponent(id));
    renderTicketChat(t);
    startTkChatPoll(id);
  }catch(e){if(body)body.innerHTML=`<div class="empty"><div class="empty-i">${ic('alert',16)}</div><p>${e.message}</p></div>`;}
}
function closeTicketChat(){stopTkChatPoll();closeOvl("tkChatOvl");tkChatId=null;tkChatClearImg();}
function renderTicketChat(t){
  const st=tkStatusInfo(t.status,false);
  const subj=document.getElementById("tkChatSubj");if(subj)subj.textContent=t.subject;
  const stEl=document.getElementById("tkChatStatus");if(stEl)stEl.innerHTML=`<span class="tk-badge ${st.c}">${st.l}</span>`;
  const body=document.getElementById("tkChatBody");if(!body)return;
  const msgs=t.messages||[];
  body.innerHTML=msgs.map(m=>{
    const mine=m.sender==="user";
    const img=m.image?`<img class="tkmsg-img" src="${m.image}" onclick="window.open('${m.image}','_blank')" alt="" loading="lazy" decoding="async">`:"";
    const txt=m.text?`<div class="tkmsg-text">${escapeHtml(m.text)}</div>`:"";
    const who=mine?"شما":"پشتیبانی";
    return `<div class="tkmsg ${mine?"tkmsg-me":"tkmsg-them"}">
      <div class="tkmsg-bubble">
        <div class="tkmsg-who">${who}</div>
        ${img}${txt}
        <div class="tkmsg-time">${m.createdAt?new Date(m.createdAt).toLocaleString("fa-IR",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):""}</div>
      </div>
    </div>`;
  }).join("")||`<div class="tkchat-loading">${ic('message',16)} پیامی نیست</div>`;
  /* a closed ticket is fully locked: disable input + show a clear notice */
  const closed=t.status==="closed";
  if(closed)body.insertAdjacentHTML("beforeend",`<div class="tkmsg-locked">${ic('lock',14)} این گفتگو توسط پشتیبانی بسته شده است</div>`);
  const ta=document.getElementById("tkChatMsg"),sb=document.getElementById("tkChatSend"),att=document.getElementById("tkChatImg");
  if(ta){ta.disabled=closed;ta.placeholder=closed?"این گفتگو بسته شده است":"پاسخ خود را بنویسید…";}
  if(sb)sb.disabled=closed;
  if(att)att.disabled=closed;
  const foot=ta?ta.closest(".tkchat-foot"):null;if(foot)foot.classList.toggle("chat-locked",closed);
  tkChatSig=t.status+":"+(t.messages?t.messages.length:0);
  if(typeof hydrateIcons==="function")hydrateIcons(body);
  body.scrollTop=body.scrollHeight;
}
function tkChatHandleImg(e){
  const f=e.target.files[0];if(!f)return;
  if(!f.type.startsWith("image/")){toast("فقط فایل تصویری مجاز است","err");return;}
  if(f.size>50*1024*1024){toast("حجم تصویر بیش از ۵۰ مگابایت","err");return;}
  tkChatImgObj=f;
  if(tkChatImgUrl)URL.revokeObjectURL(tkChatImgUrl);
  tkChatImgUrl=URL.createObjectURL(f);
  const prev=document.getElementById("tkChatImgPrev");
  const wrap=document.getElementById("tkChatImgWrap");
  if(prev)prev.src=tkChatImgUrl;
  if(wrap)wrap.style.display="flex";
}
function tkChatClearImg(){
  tkChatImgObj=null;
  if(tkChatImgUrl){URL.revokeObjectURL(tkChatImgUrl);tkChatImgUrl="";}
  const inp=document.getElementById("tkChatImg");if(inp)inp.value="";
  const wrap=document.getElementById("tkChatImgWrap");if(wrap)wrap.style.display="none";
}
async function sendTicketReply(){
  if(!tkChatId)return;
  const ta=document.getElementById("tkChatMsg");
  const text=ta?ta.value.trim():"";
  if(!text&&!tkChatImgObj){toast("پیام خالی است","err");return;}
  const btn=document.getElementById("tkChatSend");
  if(btn)btn.disabled=true;
  try{
    const fd=new FormData();
    fd.append("message",text);
    if(tkChatImgObj)fd.append("image",tkChatImgObj);
    const r=await api("POST","/tickets/"+encodeURIComponent(tkChatId)+"/messages",fd);
    if(ta)ta.value="";
    tkChatClearImg();
    renderTicketChat(r.ticket);
    loadSupport();
  }catch(e){toast(e.message,"err");}
  finally{if(btn)btn.disabled=false;}
}
function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function submitTicket(){
  const subject=document.getElementById("spSubject").value.trim();
  const message=document.getElementById("spMessage").value;
  if(!subject){toast("موضوع الزامی است","err");return;}
  if(!message.trim()){toast("متن پیام الزامی است","err");return;}
  if(message.length>250){toast("پیام بیش از ۲۵۰ کاراکتر است","err");return;}
  const btn=document.getElementById("spSubmitBtn");
  btn.disabled=true;btn.innerHTML=ic("clock",15)+" در حال ارسال...";
  try{
    const fd=new FormData();
    fd.append("subject",subject);
    fd.append("message",message);
    if(spImageObj)fd.append("image",spImageObj);
    await api("POST","/tickets",fd);
    toast(" تیکت ارسال شد","ok");
    document.getElementById("spSubject").value="";
    document.getElementById("spMessage").value="";
    spClearImg();spUpdateCount();
    loadSupport();
  }catch(e){toast(e.message,"err");}
  finally{btn.disabled=false;btn.innerHTML=ic("send",15)+" ارسال تیکت";}
}

/* 3D BOOK — pointer tilt only on real desktop pointers (skip touch/low-end,
   where it never fires usefully and CSS pins the book static for performance) */
(function(){
  const finePointer=window.matchMedia&&window.matchMedia("(hover:hover) and (pointer:fine)").matches;
  const wideEnough=window.innerWidth>980;
  const reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  if(!finePointer||!wideEnough||reduced)return;
  document.addEventListener("mousemove",e=>{const b=document.getElementById("book3d");if(!b)return;const x=(e.clientX/window.innerWidth-.5)*20,y=(e.clientY/window.innerHeight-.5)*8;b.style.transform=`rotateY(${-16+x}deg) rotateX(${4-y}deg)`;},{passive:true});
})();

/* SCROLL ANIMS */
const obs=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add("v");}),{threshold:.12,rootMargin:"0px 0px -40px 0px"});
document.querySelectorAll(".fu").forEach(el=>obs.observe(el));

/* INIT */
/* ══ CONTACT FORM ══ */
function validateField(id,check){
  const el=document.getElementById(id);
  const grp=document.getElementById("cfg-"+id.replace("cnt","").toLowerCase());
  if(!el||!grp)return true;
  const ok=check(el.value);
  grp.classList.toggle("has-err",!ok);
  if(!ok)el.classList.add("err");else el.classList.remove("err");
  return ok;
}
async function sendContact(){
  const btn=document.getElementById("cntSendBtn");
  const n=validateField("cntName",v=>v.trim().length>=2,"name");
  const e=validateField("cntEmail",v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),"email");
  const s=validateField("cntSubj",v=>v!=="","subj");
  const m=validateField("cntMsg",v=>v.trim().length>=10,"msg");
  // fix field IDs for validate
  const nameOk=document.getElementById("cntName").value.trim().length>=2;
  const emailOk=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.getElementById("cntEmail").value.trim());
  const subjOk=document.getElementById("cntSubj").value!=="";
  const msgOk=document.getElementById("cntMsg").value.trim().length>=10;
  ["name","email","subj","msg"].forEach(f=>{
    const el=document.getElementById("cnt"+f.charAt(0).toUpperCase()+f.slice(1));
    const grp=document.getElementById("cfg-"+f);
    if(!el||!grp)return;
    const checks={name:()=>el.value.trim().length>=2,email:()=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()),subj:()=>el.value!=="",msg:()=>el.value.trim().length>=10};
    const ok=checks[f]();
    grp.classList.toggle("has-err",!ok);
    el.classList.toggle("err",!ok);
  });
  if(!nameOk||!emailOk||!subjOk||!msgOk)return;
  btn.disabled=true;btn.textContent="در حال ارسال...";
  // Simulate email send (in production connect to your backend)
  await new Promise(r=>setTimeout(r,1400));
  document.getElementById("cntForm").style.display="none";
  document.getElementById("cntSuccess").classList.add("show");
  toast(" پیام شما ارسال شد","ok");
  btn.disabled=false;
  btn.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> ارسال پیام`;
}

/* ══ PERFORMANCE: debounced render, passive events, cache DOM refs ══ */
const _domCache={};
function $id(id){return _domCache[id]||(_domCache[id]=document.getElementById(id))}

/* ══ INIT ══ */
/* ═══════════ ICON HYDRATION ═══════════ */
/* Replaces every <i class="ico-slot" data-ic="NAME"> with an inline SVG */
function hydrateIcons(root){
  (root||document).querySelectorAll(".ico-slot[data-ic]").forEach(el=>{
    const name=el.getAttribute("data-ic");
    const sz=el.getAttribute("data-sz")||16;
    el.innerHTML=ic(name,+sz);
    el.classList.add("ico-ready");
  });
}

/* ═══════════ PAGE-AWARE BOOTSTRAP ═══════════ */
function currentPage(){
  const f=(location.pathname.split("/").pop()||"index.html").toLowerCase();
  return ({"":"home","index.html":"home","shop.html":"shop","qr.html":"qr",
    "about.html":"about","contact.html":"contact","dashboard.html":"dash",
    "checkout.html":"checkout","detail.html":"detail","terms.html":"terms"})[f]||"home";
}

async function init(){
  /* theme before paint — no FOUC */
  const t=localStorage.getItem("tb_theme")||"light";
  document.documentElement.setAttribute("data-theme",t);

  /* hydrate all static icons immediately */
  hydrateIcons(document);

  /* shared chrome */
  try{await loadProds();}catch{}
  renderNav();
  updateCartBadge();

  const page=currentPage();

  /* mark active states in nav + tab bar */
  document.querySelectorAll(".nav-links a").forEach(a=>a.classList.remove("on"));
  const nl=document.getElementById("nl-"+page);if(nl)nl.classList.add("on");
  document.querySelectorAll(".mbt").forEach(b=>b.classList.remove("active"));
  const mbt=document.getElementById("mbt-"+page);if(mbt)mbt.classList.add("active");

  /* Fix 6: On the dashboard, hide the main bottom bar and show the
     dedicated User-Panel tab bar instead (handled via body class + CSS). */
  if(page==="dash"){
    document.body.classList.add("on-dash");
    const dtb=document.getElementById("dtb-pu");if(dtb)dtb.classList.add("active");
  }

  /* per-page bootstrapping */
  if(page==="home"){
    renderFeatured();
    setTimeout(()=>{const hc=$id("heroContent");if(hc)hc.classList.add("loaded");},120);
  }
  if(page==="shop"){
    curPage=1;
    /* search term can arrive via ?q= (Google sitelinks search / shared links)
       or via a forwarded QR scan in sessionStorage */
    try{
      const qp=new URLSearchParams(location.search).get("q");
      const fwd=qp||sessionStorage.getItem("tb_shop_q");
      if(fwd){sessionStorage.removeItem("tb_shop_q");sfQ=fwd;const si=document.getElementById("isInp");if(si)si.value=fwd;}
    }catch{}
    renderShop();
    if(sfQ&&typeof showLocalIS==="function")showLocalIS(sfQ);
  }
  if(page==="dash"){loadDash();}
  if(page==="checkout"){renderCheckout();}
  if(page==="detail"){
    const params=new URLSearchParams(location.search);
    const id=params.get("id");
    /* allProds is already loaded (lightweight, no fileData/base64 bloat).
       Fall back to a direct fetch if the id isn't in the cached list. */
    let prod=allProds.find(p=>p.id===id);
    if(!prod&&id){
      try{prod=await api("GET","/products/"+encodeURIComponent(id));}catch{}
    }
    if(prod)renderDetail(prod);
    else document.getElementById("dtGrid").innerHTML=
      '<div class="empty"><div class="empty-i">'+ic("alert",40)+'</div><p>محصول یافت نشد</p></div>';
  }

  /* hide loader + final icon sweep (covers JS-rendered content) */
  const loaderEl=document.getElementById("loader");
  if(loaderEl){
    /* Loader exists only on index.html. Show it once per browser session. */
    if(page==="home" && !sessionStorage.getItem("tb_seenLoader")){
      sessionStorage.setItem("tb_seenLoader","1");
      /* shorter splash → faster perceived load on low-end devices */
      setTimeout(()=>{hideLoader();hydrateIcons(document);},450);
    }else{
      /* Already seen this session → skip the animation entirely */
      loaderEl.classList.add("hidden");
      hydrateIcons(document);
    }
  }else{
    /* Non-home pages have no loader */
    hydrateIcons(document);
  }
}

/* ─── Re-hydrate icons after any dynamic render ─── */
(function(){
  /* Coalesce many hydrate calls in one frame into a single DOM sweep —
     prevents O(n) document scans when a list renders many items. */
  let pending=false;
  function scheduleHydrate(){
    if(pending)return;
    pending=true;
    requestAnimationFrame(()=>{pending=false;hydrateIcons(document);});
  }
  const wrap=(name)=>{
    const orig=window[name];
    if(typeof orig!=="function")return;
    window[name]=function(){
      const r=orig.apply(this,arguments);
      if(r&&typeof r.then==="function"){r.then(scheduleHydrate);}
      else{scheduleHydrate();}
      return r;
    };
  };
  /* NOTE: prodCard is intentionally NOT wrapped — it returns a string and
     is called once per card; wrapping it caused a full-document icon
     sweep for every single card. renderShop/renderFeatured cover it. */
  ["renderNav","renderFeatured","renderShop","renderDetail","renderRevs",
   "renderCartBody","renderCheckout","loadDash","renderMobMenuAuth",
   "showLocalIS","doIS"].forEach(wrap);
})();

init();

/* ─── PWA: register the service worker (offline + installable) ─── */
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("/sw.js").then(reg=>{
      /* if an updated SW is found, activate it as soon as it's ready */
      reg.addEventListener("updatefound",()=>{
        const nw=reg.installing;
        if(nw)nw.addEventListener("statechange",()=>{
          if(nw.state==="installed"&&navigator.serviceWorker.controller)nw.postMessage&&reg.waiting&&reg.waiting.postMessage("SKIP_WAITING");
        });
      });
    }).catch(()=>{});
    /* reload once when a new SW takes control, so the user gets fresh assets */
    let _swReloaded=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(_swReloaded)return;_swReloaded=true;location.reload();
    });
  });
}