// SkSL versions of the PatternWaves field and mark shaders for the native Skia renderer.
// Same math as shaders.ts with three changes forced by SkSL: the uvec3 bit hash becomes a float hash
// (same gradient noise structure), int uniforms become floats, and texelFetch becomes a child shader.
// The field texel now holds (level, emphasis, lift, 1) so it survives a premultiplied surface; the
// per mark fade and intro alpha moved into the mark pass. The pointer ripple sim is replaced by
// analytic rings (uRings: x, y in GL css px, age in seconds, amplitude).

export const RING_COUNT = 12;

export const skiaFieldShader = `
uniform float2 uSize;
uniform float uDpr;
uniform float2 uOrigin;
uniform float2 uPitch;
uniform float2 uGrid;
uniform float uWave;
uniform float uTime;
uniform float uUnit;
uniform float2 uHeading;
uniform float uAmp;
uniform float uDepth;
uniform float3 uLight;
uniform float uShine;
uniform float uContrast;
uniform float uInk;
uniform float uRipple;
uniform float uRippleSpeed;
uniform float uRippleWidth;
uniform float4 uRings[${RING_COUNT}];

const float FOLDS = 5.5;

float3 lattice(float3 c) {
  float3 p = fract(c * float3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}

float gradientNoise(float3 p) {
  float3 i = floor(p);
  float3 f = p - i;
  float3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(lattice(i), f);
  float n100 = dot(lattice(i + float3(1.0, 0.0, 0.0)), f - float3(1.0, 0.0, 0.0));
  float n010 = dot(lattice(i + float3(0.0, 1.0, 0.0)), f - float3(0.0, 1.0, 0.0));
  float n110 = dot(lattice(i + float3(1.0, 1.0, 0.0)), f - float3(1.0, 1.0, 0.0));
  float n001 = dot(lattice(i + float3(0.0, 0.0, 1.0)), f - float3(0.0, 0.0, 1.0));
  float n101 = dot(lattice(i + float3(1.0, 0.0, 1.0)), f - float3(1.0, 0.0, 1.0));
  float n011 = dot(lattice(i + float3(0.0, 1.0, 1.0)), f - float3(0.0, 1.0, 1.0));
  float n111 = dot(lattice(i + float3(1.0, 1.0, 1.0)), f - float3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

float surface(float2 p, float t) {
  if (uWave < 0.5) {
    float2 side = float2(-uHeading.y, uHeading.x);
    float u = dot(p, uHeading);
    float v = dot(p, side);
    float bend = gradientNoise(float3(v * 0.85, u * 0.3, t * 0.05)) * 1.7 + 0.4 * sin(v * 1.6 + t * 0.2);
    float phase = u * FOLDS + bend - t * 0.45;
    float swell = 0.6 + 0.4 * gradientNoise(float3(u * 0.55 + 3.0, v * 0.45, t * 0.04));
    float fold = sin(phase) + 0.32 * sin(2.0 * phase + 1.3);
    float ripple = 0.16 * sin(u * FOLDS * 2.5 + bend * 1.9 - t * 0.9 + 2.1);
    return (fold + ripple) * swell;
  }
  if (uWave < 1.5) {
    float bend = gradientNoise(float3(p * 0.6, t * 0.05)) * 0.6;
    float phase = dot(p, uHeading) * 15.0 + bend * 2.2 - t * 1.4;
    float swell = sin(phase) + 0.3 * sin(2.0 * phase - 0.8);
    float roll = 0.75 + 0.25 * gradientNoise(float3(p * 0.9 + 11.0, t * 0.05));
    return 0.8 * swell * roll;
  }
  float r = length(p + uHeading * 1.2);
  float bend = gradientNoise(float3(p * 1.2, t * 0.05)) * 0.1;
  return sin((r + bend) * 9.0 - t * 1.8) * (0.45 + 0.55 * exp(-(r - 0.6) * 0.8));
}

float rings(float2 css) {
  float h = 0.0;
  for (int i = 0; i < ${RING_COUNT}; i++) {
    float4 ring = uRings[i];
    if (ring.w <= 0.0) continue;
    float front = uRippleSpeed * ring.z;
    float s = (length(css - ring.xy) - front) / uRippleWidth;
    if (abs(s) > 3.5) continue;
    h -= ring.w * exp(-1.52 * ring.z) * exp(-s * s) * cos(s * 2.4) / sqrt(1.0 + front / uRippleWidth);
  }
  return h;
}

float heightAt(float2 css) {
  float h = surface((css - 0.5 * uSize) / uUnit, uTime) * uAmp;
  if (uRipple > 0.0) h += rings(css) * uRipple;
  return h;
}

half4 main(float2 xy) {
  float2 cell = float2(floor(xy.x), uGrid.y - 1.0 - floor(xy.y));
  float2 center = uOrigin + (cell + 0.5) * uPitch;
  float2 css = center / uDpr;
  float e = max(uPitch.y / uDpr, 4.0);
  float h = heightAt(css);
  float hx = (heightAt(css + float2(e, 0.0)) - heightAt(css - float2(e, 0.0))) / (2.0 * e);
  float hy = (heightAt(css + float2(0.0, e)) - heightAt(css - float2(0.0, e))) / (2.0 * e);
  float2 grad = float2(hx, hy) * uUnit * uDepth * 0.4;
  float3 n = normalize(float3(-grad, 1.0));

  float diffuse = clamp(dot(n, uLight), 0.0, 1.0);
  float3 halfway = normalize(uLight + float3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(n, halfway), 0.0, 1.0), 160.0) * uShine * 1.15;
  float hollow = 0.7 + 0.3 * clamp(h * 0.5 + 0.5, 0.0, 1.0);
  float tone = clamp(diffuse * hollow * 0.78 + spec, 0.0, 1.0);
  tone = clamp((tone - 0.42) * uContrast + 0.42, 0.0, 1.0);

  float level = uInk > 0.5 ? pow(clamp(1.0 - tone / 0.46, 0.0, 1.0), 2.4) * 0.72 : pow(tone, 2.2);
  float emphasis = uInk > 0.5 ? smoothstep(0.55, 0.95, level) : clamp(spec * 1.6, 0.0, 1.0);
  float lift = clamp(h * uDepth * 0.42, -0.48, 0.48);
  return half4(level, emphasis, lift + 0.5, 1.0);
}
`;

export const skiaMarkShader = `
uniform shader tField;
uniform float2 uSize;
uniform float uDpr;
uniform float uPxScale;
uniform float2 uCanvas;
uniform float2 uOrigin;
uniform float2 uPitch;
uniform float2 uGrid;
uniform float uPattern;
uniform float uMarkSize;
uniform float uStroke;
uniform float3 uColor;
uniform float3 uAccent;
uniform float4 uBackground;
uniform float uOpacity;
uniform float uFade;
uniform float uFadeSize;
uniform float uAppear;

// (level, alpha, emphasis, lift) for one mark, like a texel of the original field target.
float4 cellAt(float cx, float cy) {
  half4 t = tField.eval(float2(cx + 0.5, uGrid.y - cy - 0.5));
  float level = t.r;
  float2 center = uOrigin + (float2(cx, cy) + 0.5) * uPitch;
  float2 css = center / uDpr;
  float2 uv = css / uSize;
  float fade = 1.0;
  float2 c = uv * 2.0 - 1.0;
  if (uFade > 0.5 && uFade < 1.5) {
    fade = 1.0 - smoothstep(1.0 - uFadeSize, 1.18, length(c));
  } else if (uFade > 1.5 && uFade < 2.5) {
    fade = mix(0.05, 1.0, smoothstep(0.08, 0.08 + uFadeSize, length(c * float2(1.0, 1.35))));
  } else if (uFade > 2.5 && uFade < 3.5) {
    fade = smoothstep(0.0, uFadeSize, uv.y);
  } else if (uFade > 3.5) {
    fade = smoothstep(0.0, uFadeSize, 1.0 - uv.y);
  }
  float reach = length(css - 0.5 * uSize) / max(0.5 * length(uSize), 1.0);
  float appear = smoothstep(reach - 0.05, reach + 0.3, uAppear * 1.35);
  float alpha = uOpacity * fade * appear * (0.22 + 0.78 * level);
  return float4(level, alpha, t.g, t.b);
}

float box(float2 p, float2 b, float r) {
  float2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float coverage(float2 local, float level) {
  float span = uPitch.y * uMarkSize;
  float area = max(sqrt(level), 0.14);
  if (uPattern < 0.5) {
    return clamp(0.5 - (length(local) - 0.5 * span * area), 0.0, 1.0);
  }
  if (uPattern < 1.5) {
    float extent = 0.5 * span * area;
    return clamp(0.5 - box(local, float2(extent), extent * 0.3), 0.0, 1.0);
  }
  float arm = 0.5 * span * mix(0.3, 1.0, level);
  float width = 0.5 * uStroke;
  return clamp(0.5 - min(box(local, float2(arm, width), width), box(local, float2(width, arm), width)), 0.0, 1.0);
}

float4 lineInk(float2 rel) {
  float fx = rel.x / uPitch.x - 0.5;
  float c0 = clamp(floor(fx), 0.0, uGrid.x - 1.0);
  float c1 = min(c0 + 1.0, uGrid.x - 1.0);
  float t = clamp(fx - c0, 0.0, 1.0);
  float row = floor(rel.y / uPitch.y);
  float4 ink = float4(0.0);
  for (int k = -1; k <= 1; k++) {
    float cy = row + float(k);
    if (cy < 0.0 || cy >= uGrid.y) continue;
    float4 a = cellAt(c0, cy);
    float4 b = cellAt(c1, cy);
    float4 f = mix(a, b, t);
    if (f.g < 0.002) continue;
    float y = (cy + 0.5 + f.a - 0.5) * uPitch.y;
    float slope = (b.a - a.a) * uPitch.y / uPitch.x;
    float thickness = max(uStroke, uPitch.y * uMarkSize * f.r);
    float d = abs(rel.y - y) / sqrt(1.0 + slope * slope) - 0.5 * thickness;
    float alpha = clamp(0.5 - d, 0.0, 1.0) * f.g;
    if (alpha > ink.a) ink = float4(mix(uColor, uAccent, f.b) * alpha, alpha);
  }
  return ink;
}

half4 main(float2 xy) {
  float2 frag = float2(xy.x * uPxScale, uCanvas.y - xy.y * uPxScale);
  float2 rel = frag - uOrigin;
  float4 background = float4(uBackground.rgb * uBackground.a, uBackground.a);
  float4 ink = float4(0.0);
  if (uPattern > 2.5) {
    ink = lineInk(rel);
  } else {
    float cx = floor(rel.x / uPitch.x);
    float row = floor(rel.y / uPitch.y);
    if (cx >= 0.0 && cx < uGrid.x) {
      for (int k = -1; k <= 1; k++) {
        float cy = row + float(k);
        if (cy < 0.0 || cy >= uGrid.y) continue;
        float4 f = cellAt(cx, cy);
        if (f.g < 0.002) continue;
        float2 center = (float2(cx, cy) + 0.5) * uPitch + float2(0.0, (f.a - 0.5) * uPitch.y);
        float alpha = coverage(rel - center, f.r) * f.g;
        if (alpha > ink.a) ink = float4(mix(uColor, uAccent, f.b) * alpha, alpha);
      }
    }
  }
  return half4(ink + background * (1.0 - ink.a));
}
`;
