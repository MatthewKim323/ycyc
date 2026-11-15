(()=>{var ke=`#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`,_e=`#version 300 es
precision highp float;
precision highp int;
uniform vec2 uSize;
uniform float uDpr;
uniform vec2 uOrigin;
uniform vec2 uPitch;
uniform int uWave;
uniform float uTime;
uniform float uUnit;
uniform vec2 uHeading;
uniform float uAmp;
uniform float uDepth;
uniform vec3 uLight;
uniform float uShine;
uniform float uContrast;
uniform float uInk;
uniform float uOpacity;
uniform int uFade;
uniform float uFadeSize;
uniform float uAppear;
uniform sampler2D tRipple;
uniform float uRipple;
out vec4 fragColor;

const float FOLDS = 5.5;

uvec3 scramble(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

vec3 lattice(vec3 corner) {
  uvec3 h = scramble(uvec3(ivec3(corner) + 4096));
  return vec3(h & 65535u) / 32767.5 - 1.0;
}

float gradientNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(lattice(i), f);
  float n100 = dot(lattice(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(lattice(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(lattice(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(lattice(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(lattice(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(lattice(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(lattice(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

vec2 turn(vec2 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float surface(vec2 p, float t) {
  if (uWave == 0) {
    vec2 side = vec2(-uHeading.y, uHeading.x);
    float u = dot(p, uHeading);
    float v = dot(p, side);
    float bend = gradientNoise(vec3(v * 0.85, u * 0.3, t * 0.05)) * 1.7 + 0.4 * sin(v * 1.6 + t * 0.2);
    float phase = u * FOLDS + bend - t * 0.45;
    float swell = 0.6 + 0.4 * gradientNoise(vec3(u * 0.55 + 3.0, v * 0.45, t * 0.04));
    float fold = sin(phase) + 0.32 * sin(2.0 * phase + 1.3);
    float ripple = 0.16 * sin(u * FOLDS * 2.5 + bend * 1.9 - t * 0.9 + 2.1);
    return (fold + ripple) * swell;
  }
  if (uWave == 1) {
    float bend = gradientNoise(vec3(p * 0.6, t * 0.05)) * 0.6;
    float phase = dot(p, uHeading) * 15.0 + bend * 2.2 - t * 1.4;
    float swell = sin(phase) + 0.3 * sin(2.0 * phase - 0.8);
    float roll = 0.75 + 0.25 * gradientNoise(vec3(p * 0.9 + 11.0, t * 0.05));
    return 0.8 * swell * roll;
  }
  float r = length(p + uHeading * 1.2);
  float bend = gradientNoise(vec3(p * 1.2, t * 0.05)) * 0.1;
  return sin((r + bend) * 9.0 - t * 1.8) * (0.45 + 0.55 * exp(-(r - 0.6) * 0.8));
}

float heightAt(vec2 css) {
  float h = surface((css - 0.5 * uSize) / uUnit, uTime) * uAmp;
  if (uRipple > 0.0) h += texture(tRipple, css / uSize).r * uRipple;
  return h;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 center = uOrigin + (cell + 0.5) * uPitch;
  vec2 css = center / uDpr;
  vec2 uv = css / uSize;
  float e = max(uPitch.y / uDpr, 4.0);
  float h = heightAt(css);
  float hx = (heightAt(css + vec2(e, 0.0)) - heightAt(css - vec2(e, 0.0))) / (2.0 * e);
  float hy = (heightAt(css + vec2(0.0, e)) - heightAt(css - vec2(0.0, e))) / (2.0 * e);
  vec2 grad = vec2(hx, hy) * uUnit * uDepth * 0.4;
  vec3 n = normalize(vec3(-grad, 1.0));

  float diffuse = clamp(dot(n, uLight), 0.0, 1.0);
  vec3 halfway = normalize(uLight + vec3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(n, halfway), 0.0, 1.0), 160.0) * uShine * 1.15;
  float hollow = 0.7 + 0.3 * clamp(h * 0.5 + 0.5, 0.0, 1.0);
  float tone = clamp(diffuse * hollow * 0.78 + spec, 0.0, 1.0);
  tone = clamp((tone - 0.42) * uContrast + 0.42, 0.0, 1.0);

  float level = uInk > 0.5 ? pow(clamp(1.0 - tone / 0.46, 0.0, 1.0), 2.4) * 0.72 : pow(tone, 2.2);
  float emphasis = uInk > 0.5 ? smoothstep(0.55, 0.95, level) : clamp(spec * 1.6, 0.0, 1.0);

  float fade = 1.0;
  vec2 c = uv * 2.0 - 1.0;
  if (uFade == 1) {
    fade = 1.0 - smoothstep(1.0 - uFadeSize, 1.18, length(c));
  } else if (uFade == 2) {
    fade = mix(0.05, 1.0, smoothstep(0.08, 0.08 + uFadeSize, length(c * vec2(1.0, 1.35))));
  } else if (uFade == 3) {
    fade = smoothstep(0.0, uFadeSize, uv.y);
  } else if (uFade == 4) {
    fade = smoothstep(0.0, uFadeSize, 1.0 - uv.y);
  }

  float reach = length(css - 0.5 * uSize) / max(0.5 * length(uSize), 1.0);
  float appear = smoothstep(reach - 0.05, reach + 0.3, uAppear * 1.35);

  float alpha = uOpacity * fade * appear * (0.22 + 0.78 * level);
  float lift = clamp(h * uDepth * 0.42, -0.48, 0.48);
  fragColor = vec4(level, alpha, emphasis, lift + 0.5);
}
`,Me=`#version 300 es
precision highp float;
uniform sampler2D tState;
uniform vec2 uTexel;
uniform vec2 uSize;
uniform vec2 uFrom;
uniform vec2 uTo;
uniform float uRadius;
uniform float uImpulse;
uniform float uDamping;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 state = texture(tState, uv).rg;
  float left = texture(tState, uv - vec2(uTexel.x, 0.0)).r;
  float right = texture(tState, uv + vec2(uTexel.x, 0.0)).r;
  float below = texture(tState, uv - vec2(0.0, uTexel.y)).r;
  float above = texture(tState, uv + vec2(0.0, uTexel.y)).r;
  float next = ((left + right + below + above) * 0.5 - state.g) * uDamping;
  vec2 p = uv * uSize;
  vec2 segment = uTo - uFrom;
  float along = clamp(dot(p - uFrom, segment) / max(dot(segment, segment), 1e-4), 0.0, 1.0);
  float d = length(p - uFrom - segment * along) / uRadius;
  next -= uImpulse * exp(-d * d * 2.0);
  fragColor = vec4(next, state.r, 0.0, 1.0);
}
`,Le=`#version 300 es
precision highp float;
precision highp int;
uniform sampler2D tField;
uniform sampler2D tAtlas;
uniform vec2 uOrigin;
uniform vec2 uPitch;
uniform vec2 uGrid;
uniform int uPattern;
uniform float uMarkSize;
uniform float uStroke;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform vec4 uBackground;
uniform vec3 uAtlas;
out vec4 fragColor;

float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float coverage(vec2 local, float level) {
  float span = uPitch.y * uMarkSize;
  float area = max(sqrt(level), 0.14);
  if (uPattern == 0) {
    return clamp(0.5 - (length(local) - 0.5 * span * area), 0.0, 1.0);
  }
  if (uPattern == 1) {
    float extent = 0.5 * span * area;
    return clamp(0.5 - box(local, vec2(extent), extent * 0.3), 0.0, 1.0);
  }
  if (uPattern == 2) {
    float arm = 0.5 * span * mix(0.3, 1.0, level);
    float width = 0.5 * uStroke;
    return clamp(0.5 - min(box(local, vec2(arm, width), width), box(local, vec2(width, arm), width)), 0.0, 1.0);
  }
  if (uAtlas.z < 1.0) return 0.0;
  vec2 g = local / span + 0.5;
  if (g.x < 0.0 || g.y < 0.0 || g.x > 1.0 || g.y > 1.0) return 0.0;
  float index = min(floor(level * uAtlas.z), uAtlas.z - 1.0);
  vec2 tile = vec2(mod(index, uAtlas.x), floor(index / uAtlas.x));
  vec2 atlasUv = (tile + vec2(g.x, 1.0 - g.y)) / uAtlas.xy;
  vec2 texel = 1.0 / (span * uAtlas.xy);
  return textureGrad(tAtlas, atlasUv, vec2(texel.x, 0.0), vec2(0.0, texel.y)).a;
}

vec4 lineInk(vec2 rel) {
  float fx = rel.x / uPitch.x - 0.5;
  float c0 = clamp(floor(fx), 0.0, uGrid.x - 1.0);
  float c1 = min(c0 + 1.0, uGrid.x - 1.0);
  float t = clamp(fx - c0, 0.0, 1.0);
  float row = floor(rel.y / uPitch.y);
  vec4 ink = vec4(0.0);
  for (int k = -1; k <= 1; k++) {
    float cy = row + float(k);
    if (cy < 0.0 || cy >= uGrid.y) continue;
    vec4 a = texelFetch(tField, ivec2(int(c0), int(cy)), 0);
    vec4 b = texelFetch(tField, ivec2(int(c1), int(cy)), 0);
    vec4 f = mix(a, b, t);
    if (f.g < 0.002) continue;
    float y = (cy + 0.5 + f.a - 0.5) * uPitch.y;
    float slope = (b.a - a.a) * uPitch.y / uPitch.x;
    float thickness = max(uStroke, uPitch.y * uMarkSize * f.r);
    float d = abs(rel.y - y) / sqrt(1.0 + slope * slope) - 0.5 * thickness;
    float alpha = clamp(0.5 - d, 0.0, 1.0) * f.g;
    if (alpha > ink.a) ink = vec4(mix(uColor, uAccent, f.b) * alpha, alpha);
  }
  return ink;
}

void main() {
  vec2 rel = gl_FragCoord.xy - uOrigin;
  vec4 background = vec4(uBackground.rgb * uBackground.a, uBackground.a);
  vec4 ink = vec4(0.0);
  if (uPattern == 3) {
    ink = lineInk(rel);
  } else {
    float cx = floor(rel.x / uPitch.x);
    float row = floor(rel.y / uPitch.y);
    if (cx >= 0.0 && cx < uGrid.x) {
      for (int k = -1; k <= 1; k++) {
        float cy = row + float(k);
        if (cy < 0.0 || cy >= uGrid.y) continue;
        vec4 f = texelFetch(tField, ivec2(int(cx), int(cy)), 0);
        if (f.g < 0.002) continue;
        vec2 center = (vec2(cx, cy) + 0.5) * uPitch + vec2(0.0, (f.a - 0.5) * uPitch.y);
        float alpha = coverage(rel - center, f.r) * f.g;
        if (alpha > ink.a) ink = vec4(mix(uColor, uAccent, f.b) * alpha, alpha);
      }
    }
  }
  fragColor = ink + background * (1.0 - ink.a);
}
`,ze=`#version 300 es
precision highp float;
uniform sampler2D tCanvas;
uniform vec2 uViewport;
out vec4 fragColor;

void main() {
  fragColor = texture(tCanvas, gl_FragCoord.xy / uViewport);
}
`;var Te={silk:{pattern:"dot",wave:"silk",spacing:9,markSize:.95,depth:.95,light:0,shine:.8,contrast:1.2,speed:.35,scale:1,direction:20},ocean:{pattern:"dot",wave:"swell",spacing:10,markSize:.9,depth:.42,light:0,shine:1,contrast:1.2,speed:.5,scale:1,direction:100},pond:{pattern:"dot",wave:"ripple",spacing:10,markSize:.9,depth:.55,light:0,shine:1.2,contrast:1.2,speed:.5,scale:1,direction:35},lines:{pattern:"line",wave:"silk",spacing:12,markSize:.42,depth:.9,light:0,shine:.6,contrast:1.2,speed:.3,scale:1,direction:20},mesh:{pattern:"plus",wave:"silk",spacing:14,markSize:.8,depth:.95,light:0,shine:1,contrast:1.45,speed:.4,scale:1.1,direction:325}},Ne={dot:0,square:1,plus:2,line:3},We={silk:0,swell:1,ripple:2},Xe={none:0,edges:1,center:2,bottom:3,top:4},He=520,De=8,Ve=60,qe=45e5,Ue=2,Ye=3,c=(e,l,x)=>Math.min(Math.max(e,l),x),Ee=e=>.2126*e[0]+.7152*e[1]+.0722*e[2],$e={black:[0,0,0,1],white:[1,1,1,1],transparent:[0,0,0,0]},Fe=(e,l)=>{if(typeof e!="string")return l;let x=e.trim().toLowerCase(),z=$e[x];if(z)return[...z];if(x.startsWith("#")){let u=x.slice(1);if(!/^[0-9a-f]+$/.test(u)||((u.length===3||u.length===4)&&(u=Array.from(u,m=>m+m).join("")),u.length!==6&&u.length!==8))return l;let h=parseInt(u.slice(0,6),16),P=u.length===8?parseInt(u.slice(6),16)/255:1;return[(h>>16&255)/255,(h>>8&255)/255,(h&255)/255,P]}let k=x.match(/^rgba?\((.*)\)$/);if(!k)return l;let p=k[1].match(/[\d.]+%?/g);if(!p||p.length<3)return l;let y=u=>c(u.endsWith("%")?parseFloat(u)/100*255:parseFloat(u),0,255)/255,O=p[3]?p[3].endsWith("%")?parseFloat(p[3])/100:parseFloat(p[3]):1;return[y(p[0]),y(p[1]),y(p[2]),c(O,0,1)]},Be=(e,l)=>{let x=e.HALF_FLOAT??5131,z=e.RGBA16F??34842;e.disable(e.BLEND),e.disable(e.DEPTH_TEST),e.disable(e.STENCIL_TEST),e.disable(e.CULL_FACE),e.depthMask(!1),e.clearColor(0,0,0,0);let k=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,k),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0);let p=[],y=(t,r)=>{let n=e.createShader(t);if(e.shaderSource(n,r),e.compileShader(n),!e.getShaderParameter(n,e.COMPILE_STATUS)){let o=e.getShaderInfoLog(n);throw e.deleteShader(n),new Error(`PatternWaves shader failed to compile: ${o}`)}return p.push(n),n},O=y(e.VERTEX_SHADER,ke),u=[],h=(t,r,n=[])=>{let o=e.createProgram();if(e.attachShader(o,O),e.attachShader(o,y(e.FRAGMENT_SHADER,t)),e.bindAttribLocation(o,0,"position"),e.linkProgram(o),!e.getProgramParameter(o,e.LINK_STATUS))throw new Error(`PatternWaves program failed to link: ${e.getProgramInfoLog(o)}`);u.push(o);let E={};return[...r,...n].forEach(f=>{E[f]=e.getUniformLocation(o,f)}),e.useProgram(o),n.forEach((f,d)=>{E[f]&&e.uniform1i(E[f],d)}),{program:o,u:E}},P=h(_e,["uSize","uDpr","uOrigin","uPitch","uWave","uTime","uUnit","uHeading","uAmp","uDepth","uLight","uShine","uContrast","uInk","uOpacity","uFade","uFadeSize","uAppear","uRipple"],["tRipple"]),m=h(Me,["uTexel","uSize","uFrom","uTo","uRadius","uImpulse","uDamping"],["tState"]),T=h(Le,["uOrigin","uPitch","uGrid","uPattern","uMarkSize","uStroke","uColor","uAccent","uBackground","uAtlas"],["tField","tAtlas"]),D=h(ze,["uViewport"],["tCanvas"]),Re=[],q=e.createTexture();e.bindTexture(e.TEXTURE_2D,q),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array(4)),Re.push(q),e.useProgram(m.program),m.u.uDamping&&e.uniform1f(m.u.uDamping,.975),e.useProgram(T.program),T.u.uAtlas&&e.uniform3f(T.u.uAtlas,1,1,0);let ee=(t,r,n,o=e.RGBA,E=e.UNSIGNED_BYTE)=>{let f=e.createTexture();e.bindTexture(e.TEXTURE_2D,f),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,n),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,n),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,o,t,r,0,e.RGBA,E,null);let d=e.createFramebuffer();return e.bindFramebuffer(e.FRAMEBUFFER,d),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,f,0),e.bindFramebuffer(e.FRAMEBUFFER,null),{width:t,height:r,texture:f,buffer:d}},F=t=>{e.deleteFramebuffer(t.buffer),e.deleteTexture(t.texture)},Ae=(t,r)=>ee(t,r,e.NEAREST),te=(t,r)=>ee(t,r,e.LINEAR,z,x);e.getExtension("EXT_color_buffer_float"),e.getExtension("EXT_color_buffer_half_float");let Se=(()=>{try{let t=te(4,4);e.bindFramebuffer(e.FRAMEBUFFER,t.buffer);let r=e.checkFramebufferStatus(e.FRAMEBUFFER)===e.FRAMEBUFFER_COMPLETE;return e.bindFramebuffer(e.FRAMEBUFFER,null),F(t),r}catch{return!1}})(),_=Ae(1,1),v=null,i=null,U=(t,r,n)=>{e.bindFramebuffer(e.FRAMEBUFFER,t?t.buffer:null),e.viewport(0,0,r,n)},Y=t=>{e.useProgram(t.program),e.drawArrays(e.TRIANGLES,0,3)},N=(t,r)=>{e.activeTexture(e.TEXTURE0+t),e.bindTexture(e.TEXTURE_2D,r)},$=!1,re=0,ae=0,g=1,R=1,A=1,w=1,b=0,j=null,ne=performance.now(),ie=0,B=0,W=!0,oe=!0,C=!0,ye=0,G=!1,K=0,a={x:0,y:0,inside:!1,placed:!1,lastX:0,lastY:0,burst:0},Ce=()=>{if(!Se)return;let t=c(Math.ceil(g/De),4,512),r=c(Math.ceil(R/De),4,512);i&&i.width===t&&i.height===r||(i&&(F(i.read),F(i.write)),i={width:t,height:r,read:te(t,r),write:te(t,r)},[i.read,i.write].forEach(n=>{U(n,n.width,n.height),e.clear(e.COLOR_BUFFER_BIT)}),e.bindFramebuffer(e.FRAMEBUFFER,null),G=!1)},Ge=()=>{i&&([i.read,i.write].forEach(t=>{U(t,t.width,t.height),e.clear(e.COLOR_BUFFER_BIT)}),e.bindFramebuffer(e.FRAMEBUFFER,null))},ue=!1,Ie=()=>{g=Math.max(1,re),R=Math.max(1,ae);let t=Math.min(l.pixelRatio()||1,Ye,Math.sqrt(qe/(g*R)));A=Math.max(1,Math.floor(g*t)),w=Math.max(1,Math.floor(R*t)),Ce(),C=!0},Oe=(t,r,n)=>{K=Math.min(K+n*Ve,4);let o=c(r.cursorStrength,0,1),E=Math.hypot(a.x-a.lastX,a.y-a.lastY),f=(a.inside?Math.min(E/14,1)*.35*o:0)+a.burst*o;a.burst=0;let d=m.u;for(e.useProgram(m.program),e.uniform2f(d.uTexel,1/t.width,1/t.height),e.uniform2f(d.uSize,g,R),e.uniform2f(d.uFrom,a.lastX,R-a.lastY),e.uniform2f(d.uTo,a.x,R-a.y),e.uniform1f(d.uRadius,c(r.cursorSize,8,400));K>=1;){K-=1,N(0,t.read.texture),e.useProgram(m.program),e.uniform1f(d.uImpulse,f),U(t.write,t.width,t.height),Y(m);let X=t.read;t.read=t.write,t.write=X,f=0}a.lastX=a.x,a.lastY=a.y},se=()=>{b=0;let t=performance.now();if(!oe)return;ue&&(ue=!1,Ie());let r=l.getSettings(),n=Math.min(.05,Math.max(1/240,(t-ne)/1e3));if(ne=t,!r||re<=0||ae<=0)return;let o=!r.paused&&!$&&r.speed!==0;j!==null?(ie=r.paused?0:j*r.speed,B=r.intro?Math.min(1,Math.max(0,j)/Ue):1):(o&&(ie+=n*r.speed),B=r.intro&&!$?Math.min(1,B+n/Ue):1);let E=1-Math.pow(1-c(B/.75,0,1),3),f=c((B-.1)/.9,0,1),d=f*f*(3-2*f),X=r.interactive&&!$&&!!i&&r.cursorStrength>0;X&&a.inside&&!a.placed&&(a.lastX=a.x,a.lastY=a.y,a.placed=!0),X&&(a.inside||a.burst>0)&&(ye=t+5e3);let Pe=X&&t<ye;Pe&&i?(Oe(i,r,n),G=!0):G&&(Ge(),G=!1);let ce=Ne[r.pattern]??0,[fe,le]=l.prepareBuffer(A,w,g,R),me=fe===A&&le===w;!me&&(!v||v.width!==A||v.height!==w)&&(v&&F(v),v=ee(A,w,e.LINEAR));let J=A/g,L=Math.max(4,Math.round(c(r.spacing,4,120)*J)),Q=ce===3?Math.max(2,Math.round(L/4)):L,H=Math.min(4096,Math.ceil(A/Q)+1),V=Math.min(4096,Math.ceil(w/L)+2),Z=[Math.floor((A-H*Q)/2),Math.floor((w-V*L)/2)];(_.width!==H||_.height!==V)&&(F(_),_=Ae(H,V));let ge=r.direction*Math.PI/180,we=(r.direction+180+c(r.light,-90,90))*Math.PI/180,I=r.background,pe=I[3]>.02?Ee(r.color)<Ee(I):Ee(r.color)<.5,s=P.u;e.useProgram(P.program),e.uniform2f(s.uSize,g,R),e.uniform1f(s.uDpr,J),e.uniform2f(s.uOrigin,Z[0],Z[1]),e.uniform2f(s.uPitch,Q,L),e.uniform1i(s.uWave,We[r.wave]??0),e.uniform1f(s.uTime,ie),e.uniform1f(s.uUnit,He*c(r.scale,.2,5)),e.uniform2f(s.uHeading,Math.cos(ge),Math.sin(ge)),e.uniform1f(s.uAmp,d),e.uniform1f(s.uDepth,c(r.depth,0,1.5)),e.uniform3f(s.uLight,Math.cos(we)*.78,Math.sin(we)*.78,.62),e.uniform1f(s.uShine,c(r.shine,0,2)),e.uniform1f(s.uContrast,c(r.contrast,.3,3)),e.uniform1f(s.uInk,pe?1:0),e.uniform1f(s.uOpacity,c(r.opacity,0,1)),e.uniform1i(s.uFade,Xe[r.fade]??0),e.uniform1f(s.uFadeSize,c(r.fadeSize,.05,1)),e.uniform1f(s.uAppear,E),e.uniform1f(s.uRipple,G?.32:0),N(0,i&&G?i.read.texture:q),U(_,H,V),e.clear(e.COLOR_BUFFER_BIT),Y(P);let S=T.u;e.useProgram(T.program),e.uniform2f(S.uOrigin,Z[0],Z[1]),e.uniform2f(S.uPitch,Q,L),e.uniform2f(S.uGrid,H,V),e.uniform1i(S.uPattern,ce),e.uniform1f(S.uMarkSize,c(r.markSize,.05,1)),e.uniform1f(S.uStroke,ce===3?.9*J:Math.max(1.1*J,L*.08));let de=pe?0:1,he=pe?.35:.55,[ve,xe,be]=r.color;e.uniform3f(S.uColor,ve,xe,be),e.uniform3f(S.uAccent,ve+(de-ve)*he,xe+(de-xe)*he,be+(de-be)*he),e.uniform4f(S.uBackground,I[0],I[1],I[2],I[3]),N(0,_.texture),N(1,q),U(me?null:v,A,w),e.clear(e.COLOR_BUFFER_BIT),Y(T),!me&&v&&(e.useProgram(D.program),e.uniform2f(D.u.uViewport,fe,le),N(0,v.texture),U(null,fe,le),e.clear(e.COLOR_BUFFER_BIT),Y(D)),e.endFrameEXP?.(),C=!1,!l.manual&&W&&(o||B<1||Pe||C)&&(b=requestAnimationFrame(se))},M=()=>{l.manual||b||!W||!oe||(ne=performance.now(),b=requestAnimationFrame(se))};return{renderAt:t=>{j=t,C=!0,se()},rippleSupported:Se,resize:(t,r)=>{re=t,ae=r,ue=!0,M()},wake:()=>{C=!0,M()},setVisible:t=>{W=t,!W&&b&&(cancelAnimationFrame(b),b=0),M()},setReducedMotion:t=>{$=t,C=!0,M()},pointerMove:(t,r,n)=>{a.x=t,a.y=r,n!==a.inside&&(a.placed=!1),a.inside=n,n&&M()},pointerDown:(t,r,n)=>{n&&(a.x=t,a.y=r,a.inside||(a.lastX=t,a.lastY=r),a.burst=1.2,M())},pointerLeave:()=>{a.inside=!1,a.placed=!1,M()},dispose:()=>{oe=!1,W=!1,b&&cancelAnimationFrame(b),b=0;try{i&&(F(i.read),F(i.write)),v&&F(v),F(_),Re.forEach(t=>e.deleteTexture(t)),u.forEach(t=>e.deleteProgram(t)),p.forEach(t=>e.deleteShader(t)),e.deleteBuffer(k),e.endFrameEXP?.()}catch{}}}};function je(e,l={}){let{preset:x="silk",color:z="#ffffff",background:k="#000000",width:p,height:y,dpr:O=1,...u}=l,h=e.getContext("webgl2",{alpha:!0,antialias:!1,premultipliedAlpha:!0,preserveDrawingBuffer:!0});if(!h)throw new Error("PatternWaves: WebGL2 unavailable");let P={...Te[x],color:Fe(z,[1,1,1,1]),background:Fe(k,[0,0,0,1]),opacity:1,fade:"edges",fadeSize:.5,interactive:!1,cursorSize:50,cursorStrength:0,intro:!0,paused:!1,...u},m=Be(h,{manual:!0,getSettings:()=>P,pixelRatio:()=>O,prepareBuffer:(T,D)=>(e.width!==T&&(e.width=T),e.height!==D&&(e.height=D),[e.width,e.height])});return m.resize(p??e.clientWidth,y??e.clientHeight),{renderAt:m.renderAt,resize:m.resize,dispose:m.dispose,settings:P}}window.PatternWaves={create:je,presets:Te};})();
