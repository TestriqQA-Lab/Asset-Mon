/**
 * Inline `<script>` that runs before any React hydration. It reads the cached
 * theme out of localStorage (written by `SettingsProvider` after every fresh
 * `/tenant-settings` fetch) and writes the corresponding `--am-*` CSS variables
 * onto `:root`, so the first frame on a return visit paints with the right
 * palette instead of falling back to the `:root` defaults baked into
 * `globals.css`.
 *
 * Kept tiny on purpose — anything richer (e.g. preset shape validation) lives
 * on the runtime side in `lib/theme.ts`.
 */

import { THEME_PRESETS, DEFAULT_PRESET, THEME_TOKENS } from '@/lib/themes';

function bootstrapScript(presetsJson: string, tokenKeys: readonly string[]): string {
  // Stringified so we can ship it as `dangerouslySetInnerHTML`. Keep this
  // self-contained: no module imports, no closures over outer scope.
  return `(function(){try{
  // The marketing landing page is brand-owned and must NEVER read from a tenant
  // override. Bail out on any non-themed route so /, /pricing, /blog, etc.
  // always paint with the :root defaults seeded in globals.css.
  var p=window.location.pathname||'';
  var THEMED=/^\\/(dashboard|platform)(\\/|$)/.test(p);
  if(!THEMED) return;
  var KEY='am.theme.v1';
  var raw=null; try{raw=window.localStorage.getItem(KEY);}catch(_){}
  if(!raw) return;
  var parsed; try{parsed=JSON.parse(raw);}catch(_){return;}
  if(!parsed) return;
  var presets=${presetsJson};
  var preset=presets[parsed.preset]||presets[${JSON.stringify(DEFAULT_PRESET)}];
  var overrides=(parsed.overrides&&typeof parsed.overrides==='object')?parsed.overrides:{};
  var keys=${JSON.stringify(tokenKeys)};
  function hex2rgb(h){if(!h||typeof h!=='string')return null;var s=h.replace(/^#/,'');if(s.length===3)s=s.split('').map(function(c){return c+c;}).join('');if(!/^[0-9a-f]{6}$/i.test(s))return null;return[parseInt(s.slice(0,2),16),parseInt(s.slice(2,4),16),parseInt(s.slice(4,6),16)];}
  var root=document.documentElement;
  function set(k,h){var rgb=hex2rgb(h);if(!rgb)return;root.style.setProperty(k,h);root.style.setProperty(k+'-rgb',rgb.join(' '));}
  var t={};
  for(var i=0;i<keys.length;i++){var k=keys[i];t[k]=overrides[k]||preset[k];set(k,t[k]);}
  // Derived ramps so legacy ink-*/brand-* utilities resolve correctly.
  function mix(a,b,p){var A=hex2rgb(a)||[0,0,0],B=hex2rgb(b)||[0,0,0];var r=Math.round(A[0]+(B[0]-A[0])*p);var g=Math.round(A[1]+(B[1]-A[1])*p);var bb=Math.round(A[2]+(B[2]-A[2])*p);function h(n){var s=n.toString(16);return s.length===1?'0'+s:s;}return '#'+h(r)+h(g)+h(bb);}
  var ink={50:t['--am-color-bg'],100:t['--am-color-surface-muted'],200:t['--am-color-border']};
  ink[300]=mix(t['--am-color-border'],t['--am-color-text-muted'],0.5);
  ink[400]=t['--am-color-text-muted'];
  ink[500]=mix(t['--am-color-text-muted'],t['--am-color-text'],0.5);
  ink[600]=t['--am-color-text'];
  ink[700]=mix(t['--am-color-text'],t['--am-color-heading'],0.5);
  ink[800]=mix(t['--am-color-text'],t['--am-color-heading'],0.85);
  ink[900]=t['--am-color-heading'];
  for(var s in ink){set('--am-ink-'+s,ink[s]);}
  // Brand ramp (HSL-derived). Imprecise vs server but close enough for first paint.
  var p=hex2rgb(t['--am-color-primary'])||[168,85,247];
  var rr=p[0]/255,gg=p[1]/255,bbb=p[2]/255;
  var mx=Math.max(rr,gg,bbb),mn=Math.min(rr,gg,bbb);
  var h2=0,sat=0,l=(mx+mn)/2;
  if(mx!==mn){var d=mx-mn;sat=l>0.5?d/(2-mx-mn):d/(mx+mn);
    if(mx===rr)h2=(gg-bbb)/d+(gg<bbb?6:0);else if(mx===gg)h2=(bbb-rr)/d+2;else h2=(rr-gg)/d+4;h2*=60;}
  function hsl2hex(H,S,L){H=((H%360)+360)%360;function hh(n){var s=Math.round(n*255).toString(16);return s.length===1?'0'+s:s;}if(S===0){var v=Math.round(L*255).toString(16);if(v.length===1)v='0'+v;return '#'+v+v+v;}var q=L<0.5?L*(1+S):L+S-L*S,P=2*L-q;function f(n){var t=((H/60+n)%6+6)%6;if(t<1)return P+(q-P)*t;if(t<3)return q;if(t<4)return P+(q-P)*(4-t);return P;}return '#'+hh(f(0))+hh(f(2))+hh(f(4));}
  var stops={50:0.96,100:0.92,200:0.85,300:0.74,400:0.62,500:0.52,600:0.45,700:0.38,800:0.30,900:0.22};
  for(var st in stops){var L2=stops[st];var S2=Math.max(0.1,Math.min(1,sat+(L2<0.5?0.05:0)-(L2>0.85?0.25:0)));set('--am-brand-'+st,hsl2hex(h2,S2,L2));}
  var hr=hex2rgb(t['--am-color-heading'])||[11,16,32];
  root.style.setProperty('--am-overlay-rgb',hr.join(' '));
}catch(e){}})();`;
}

/** Inline script element — must be rendered server-side, ideally in <head>. */
export function ThemeBootstrap() {
  return (
    <script
      // Loaded synchronously before paint so cached themes apply with no FOUC.
      dangerouslySetInnerHTML={{ __html: bootstrapScript(JSON.stringify(THEME_PRESETS), THEME_TOKENS) }}
    />
  );
}
