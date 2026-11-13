import { RunoffEngine } from './runoff';
import type { RunoffObstacle } from './runoff';
import type { Dab, Material, PaintOperation, Point, SprayStroke, Stroke } from './settings';

type ChromeMaterial = Exclude<Material, 'paint'>;
const chromeMaterials: ChromeMaterial[] = ['silver-chrome', 'copper-chrome', 'gold-chrome'];
const fullscreenVertex = `#version 300 es
precision highp float;
out highp vec2 v_uv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); v_uv=p; gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;
const displayFragment = `#version 300 es
precision highp float;
in highp vec2 v_uv; out highp vec4 outColor; uniform highp sampler2D u_base;
void main(){ outColor=texture(u_base,v_uv); }`;
const chromeFragment = `#version 300 es
precision highp float;
in highp vec2 v_uv; uniform highp sampler2D u_silverMask; uniform highp sampler2D u_copperMask; uniform highp sampler2D u_goldMask; out highp vec4 outColor;
void main(){
  float silver=texture(u_silverMask,v_uv).a;
  float copper=texture(u_copperMask,v_uv).a;
  float gold=texture(u_goldMask,v_uv).a;
  float coverage=1.0-(1.0-silver)*(1.0-copper)*(1.0-gold);
  if(coverage<=0.001) discard;
  float tintWeight=max(silver+copper+gold,0.001);
  vec3 tint=(silver*vec3(0.72,0.76,0.80)+copper*vec3(0.64,0.30,0.16)+gold*vec3(0.78,0.57,0.16))/tintWeight;
  vec3 reflectionTint=(silver*vec3(1.0,1.0,1.0)+copper*vec3(1.0,0.74,0.53)+gold*vec3(1.0,0.87,0.52))/tintWeight;
  vec2 uv=vec2(v_uv.x,1.0-v_uv.y);
  float band=0.28+0.17*smoothstep(0.02,0.42,sin(uv.y*6.283)*0.5+0.5)+0.13*smoothstep(0.34,0.72,sin(uv.y*12.566+0.7)*0.5+0.5)+0.012*sin(uv.y*18.85+uv.x*2.2);
  float key=exp(-pow((uv.x-0.22)/0.16,2.0))*smoothstep(0.06,0.23,uv.y)*(1.0-smoothstep(0.72,0.94,uv.y));
  float strip=exp(-pow((uv.x-0.72)/0.11,2.0))*smoothstep(0.10,0.29,uv.y)*(1.0-smoothstep(0.58,0.82,uv.y));
  float box=exp(-pow((uv.x-0.48)/0.23,2.0)-pow((uv.y-0.13)/0.15,2.0));
  float studio=exp(-pow((uv.x-0.36)/0.035,2.0))*(0.62+0.38*sin(uv.y*5.1+0.6)*0.5+0.19);
  float softbox=exp(-pow((uv.x-0.12)/0.022,2.0))*(0.68+0.32*sin(uv.y*4.4+0.8)*0.5+0.16);
  float stripLight=exp(-pow((uv.x-0.59)/0.018,2.0))*(0.58+0.42*smoothstep(0.1,0.86,sin(uv.y*6.8+uv.x*1.7)*0.5+0.5));
  float value=clamp(band+0.30*key+0.24*strip+0.18*box+0.12*studio+0.12*softbox+0.11*stripLight,0.24,1.15);
  float reflectionLevel=smoothstep(0.24,0.84,value);
  vec3 body=tint*(0.10+0.64*value);
  vec3 color=mix(body,reflectionTint*value,0.82*reflectionLevel);
  outColor=vec4(color,coverage);
}`;
const environmentChromeFragment = `#version 300 es
precision highp float;
in highp vec2 v_uv; uniform highp sampler2D u_silverMask; uniform highp sampler2D u_copperMask; uniform highp sampler2D u_goldMask; uniform highp sampler2D u_environment; uniform highp float u_reflectionIntensity; out highp vec4 outColor;
float silhouette(vec2 uv){ float s=texture(u_silverMask,uv).a; float c=texture(u_copperMask,uv).a; float g=texture(u_goldMask,uv).a; return 1.0-(1.0-s)*(1.0-c)*(1.0-g); }
vec3 srgbToLinear(vec3 c){ return mix(pow((c+0.055)/1.055,vec3(2.4)),c/12.92,lessThanEqual(c,vec3(0.04045))); }
vec3 linearToSrgb(vec3 c){ c=max(c,vec3(0.0)); return mix(1.055*pow(c,vec3(1.0/2.4))-0.055,12.92*c,lessThanEqual(c,vec3(0.0031308))); }
void main(){
  float silver=texture(u_silverMask,v_uv).a; float copper=texture(u_copperMask,v_uv).a; float gold=texture(u_goldMask,v_uv).a;
  float coverage=1.0-(1.0-silver)*(1.0-copper)*(1.0-gold); if(coverage<=0.001) discard;
  float weight=max(silver+copper+gold,0.001);
  vec3 tint=(silver*vec3(0.72,0.76,0.80)+copper*vec3(0.64,0.30,0.16)+gold*vec3(0.78,0.57,0.16))/weight;
  vec2 texel=1.0/vec2(textureSize(u_silverMask,0));
  vec2 stepUv=texel*12.0;
  float left=silhouette(v_uv-vec2(stepUv.x,0.0)); float right=silhouette(v_uv+vec2(stepUv.x,0.0));
  float top=silhouette(v_uv+vec2(0.0,stepUv.y)); float bottom=silhouette(v_uv-vec2(0.0,stepUv.y));
  vec2 slope=vec2(right-left,top-bottom);
  vec3 normal=normalize(vec3(-slope*2.2,1.0));
  vec2 envUv=clamp(vec2(v_uv.x+normal.x*0.34,0.5+normal.y*0.40+normal.z*0.18),vec2(0.0),vec2(1.0));
  vec3 envLinear=srgbToLinear(texture(u_environment,envUv).rgb);
  vec3 tintLinear=srgbToLinear(tint);
  float fresnel=pow(1.0-normal.z,2.0);
  vec3 reflected=tintLinear*(0.025+2.1*envLinear);
  vec3 body=tintLinear*(0.07+0.06*normal.z);
  vec3 linearColor=mix(body,reflected,clamp(u_reflectionIntensity,0.0,1.0)*(0.82+0.18*fresnel));
  linearColor+=tintLinear*pow(max(dot(normal,normalize(vec3(-0.25,0.55,0.79))),0.0),38.0)*0.45;
  vec3 color=linearToSrgb(linearColor/(vec3(1.0)+linearColor));
  outColor=vec4(color,coverage);
}`;
const mirrorBallChromeFragment = `#version 300 es
precision highp float;
in highp vec2 v_uv;
uniform highp sampler2D u_silverMask;
uniform highp sampler2D u_copperMask;
uniform highp sampler2D u_goldMask;
uniform highp sampler2D u_reflectionMap;
uniform highp float u_reflectionIntensity;
out highp vec4 outColor;
float silhouette(vec2 uv){ float s=texture(u_silverMask,uv).a; float c=texture(u_copperMask,uv).a; float g=texture(u_goldMask,uv).a; return 1.0-(1.0-s)*(1.0-c)*(1.0-g); }
vec3 srgbToLinear(vec3 c){ return mix(pow((c+0.055)/1.055,vec3(2.4)),c/12.92,lessThanEqual(c,vec3(0.04045))); }
vec3 linearToSrgb(vec3 c){ c=max(c,vec3(0.0)); return mix(1.055*pow(c,vec3(1.0/2.4))-0.055,12.92*c,lessThanEqual(c,vec3(0.0031308))); }
void main(){
  float silver=texture(u_silverMask,v_uv).a; float copper=texture(u_copperMask,v_uv).a; float gold=texture(u_goldMask,v_uv).a;
  float coverage=1.0-(1.0-silver)*(1.0-copper)*(1.0-gold); if(coverage<=0.001) discard;
  float weight=max(silver+copper+gold,0.001);
  vec3 tint=(silver*vec3(0.72,0.76,0.80)+copper*vec3(0.64,0.30,0.16)+gold*vec3(0.78,0.57,0.16))/weight;
  vec2 texel=1.0/vec2(textureSize(u_silverMask,0));
  vec2 stepUv=texel*12.0;
  float left=silhouette(v_uv-vec2(stepUv.x,0.0)); float right=silhouette(v_uv+vec2(stepUv.x,0.0));
  float top=silhouette(v_uv+vec2(0.0,stepUv.y)); float bottom=silhouette(v_uv-vec2(0.0,stepUv.y));
  vec2 slope=vec2(right-left,top-bottom);
  vec3 normal=normalize(vec3(-slope*2.2,1.0));
  vec3 viewDirection=vec3(0.0,0.0,1.0);
  vec3 reflectionDirection=reflect(-viewDirection,normal);
  // Mirror-ball projection: map a reflected direction to its half-vector on
  // the source sphere. The supplied image fills the disk in both dimensions.
  float denominator=sqrt(max(2.0*(1.0+reflectionDirection.z),0.0001));
  vec2 mirrorBallUv=clamp(0.5+0.5*reflectionDirection.xy/denominator,vec2(0.0),vec2(1.0));
  float reflectionSrgb=texture(u_reflectionMap,mirrorBallUv).r;
  float reflectionLinear=srgbToLinear(vec3(reflectionSrgb)).r;
  vec3 tintLinear=srgbToLinear(tint);
  float fresnel=pow(1.0-normal.z,2.0);
  vec3 reflected=tintLinear*(0.025+2.1*reflectionLinear);
  vec3 body=tintLinear*(0.07+0.06*normal.z);
  vec3 linearColor=mix(body,reflected,clamp(u_reflectionIntensity,0.0,1.0)*(0.82+0.18*fresnel));
  linearColor+=tintLinear*pow(max(dot(normal,normalize(vec3(-0.25,0.55,0.79))),0.0),38.0)*0.45;
  vec3 color=linearToSrgb(linearColor/(vec3(1.0)+linearColor));
  outColor=vec4(color,coverage);
}`;
const dabVertex = `#version 300 es
precision highp float; precision highp int;
in highp vec3 a_dab; uniform highp vec2 u_targetSize; uniform highp vec2 u_scale; uniform highp float u_brushSize; uniform highp int u_shape; out highp float v_angle; out highp float v_brushSizePx; out highp float v_pointSize; out highp vec2 v_world;
void main(){ vec2 p=a_dab.xy*u_scale; vec2 clip=p/u_targetSize*2.0-1.0; gl_Position=vec4(clip.x,-clip.y,0.0,1.0); v_world=a_dab.xy; v_angle=a_dab.z; v_brushSizePx=u_brushSize*u_scale.y; float c=abs(cos(a_dab.z)); float s=abs(sin(a_dab.z)); float extent=(u_shape==2||u_shape==3)?1.8:u_shape==1?c+s:1.0; float pointSize=max(1.0,v_brushSizePx*extent+(u_shape==1?2.0*u_scale.y:0.0)); gl_PointSize=pointSize; v_pointSize=pointSize; }`;
const surfaceMaterialShader = `
uniform highp sampler2D u_aoMap;
uniform highp int u_hasAoMap; uniform highp int u_applySurfaceMaterial;
uniform highp float u_surfaceAoStrength;
vec3 shadeSurfacePaint(vec3 color, vec2 uv){
  if(u_applySurfaceMaterial==0) return color;
  if(u_hasAoMap==1) color*=mix(1.0,texture(u_aoMap,uv).r,u_surfaceAoStrength);
  return color;
}
`;
const baseFragment = `#version 300 es
precision highp float; precision highp int;
uniform highp vec3 u_color; uniform highp int u_shape; uniform highp int u_maskOnly; uniform highp int u_hasPaintMask; uniform highp sampler2D u_paintMask; uniform highp vec2 u_logicalSize; uniform highp vec2 u_targetSize; uniform highp vec2 u_scale; in highp float v_angle; in highp float v_brushSizePx; in highp float v_pointSize; in highp vec2 v_world; out highp vec4 outColor;
${surfaceMaterialShader}
void main(){ vec2 p=gl_PointCoord-vec2(0.5); float coverage=1.0; if(u_shape==0 && dot(p,p)>0.25) discard; if(u_shape!=0){ float c=cos(v_angle); float s=sin(v_angle); vec2 q=vec2(c*p.x+s*p.y,-s*p.x+c*p.y); if(u_shape==1){ vec2 pixel=q*v_pointSize; float edge=v_brushSizePx*0.5-max(abs(pixel.x),abs(pixel.y)); coverage=clamp(edge+0.5,0.0,1.0); if(coverage<=0.0) discard; } else if(u_shape==2){ if((q.x*q.x)/(0.25)+(q.y*q.y)/(0.0378)>1.0) discard; } else { bool inShortSegment=q.x>=-0.5 && q.x<=-0.2; bool inLongSegment=q.x>=-0.1 && q.x<=0.5; if(abs(q.y)>0.1722222 || !(inShortSegment || inLongSegment)) discard; } } vec2 maskUv=vec2(gl_FragCoord.x/(u_scale.x*u_logicalSize.x),gl_FragCoord.y/(u_scale.y*u_logicalSize.y)); float paintability=u_hasPaintMask==1?texture(u_paintMask,maskUv).r:1.0; coverage*=paintability; if(coverage<=0.001) discard; vec3 color=u_maskOnly==1?vec3(1.0):shadeSurfacePaint(u_color,maskUv); outColor=vec4(color,coverage); }`;
const sprayVertex = `#version 300 es
precision highp float;
in highp vec4 a_particle; uniform highp vec2 u_targetSize; uniform highp vec2 u_scale; uniform highp float u_nozzleAspect; uniform highp float u_nozzleRotation;
out highp float v_pressure; out highp vec2 v_uv; out highp vec2 v_world; out highp vec2 v_center;
void main(){ vec2 corners[4]=vec2[4](vec2(-0.5,-0.5),vec2(0.5,-0.5),vec2(-0.5,0.5),vec2(0.5,0.5)); vec2 corner=corners[gl_VertexID]; float scale=min(u_scale.x,u_scale.y); vec2 local=vec2(corner.x,corner.y*u_nozzleAspect)*a_particle.z*scale; float c=cos(u_nozzleRotation); float s=sin(u_nozzleRotation); vec2 rotated=vec2(c*local.x-s*local.y,s*local.x+c*local.y); vec2 pixel=a_particle.xy*u_scale+rotated; vec2 clip=pixel/u_targetSize*2.0-1.0; gl_Position=vec4(clip.x,-clip.y,0.0,1.0); v_pressure=a_particle.w; v_uv=corner+vec2(0.5); v_world=pixel/u_scale; v_center=a_particle.xy; }`;
const sprayFragment = `#version 300 es
precision highp float;
uniform highp vec3 u_color; uniform highp int u_hasPaintMask; uniform highp sampler2D u_paintMask; uniform highp vec2 u_logicalSize; uniform highp vec2 u_scale; uniform highp float u_nozzleAspect; in highp float v_pressure; in highp vec2 v_uv; in highp vec2 v_world; in highp vec2 v_center; out highp vec4 outColor;
// The vertex shader already scales the quad by nozzle aspect; UVs span that full footprint.
${surfaceMaterialShader}
void main(){ vec2 p=v_uv-vec2(0.5); vec2 shapePoint=p; float r=length(shapePoint)*2.0; float angle=atan(shapePoint.y,shapePoint.x); float phase=v_center.x*0.17+v_center.y*0.13; float boundary=1.0+sin(angle*5.0+phase)*0.025+sin(angle*9.0-phase*0.7)*0.012; if(r>boundary) discard; r/=boundary; float pressure=clamp(v_pressure,0.0,1.0); float density=0.025+0.975*pow(pressure,1.25); float edgeStart=mix(0.2,0.78,pressure); float falloff=1.0-smoothstep(edgeStart,1.0,r); vec2 uv=vec2(v_world.x/u_logicalSize.x,1.0-v_world.y/u_logicalSize.y); float paintability=u_hasPaintMask==1?texture(u_paintMask,uv).r:1.0; vec3 color=shadeSurfacePaint(u_color,uv); outColor=vec4(color,density*falloff*paintability); }`;
const runoffVertex = `#version 300 es
precision highp float;
in highp vec2 a_position; in highp vec3 a_color; uniform highp vec2 u_resolution; out highp vec3 v_color; out highp vec2 v_world;
void main(){ vec2 p=a_position/u_resolution; gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0); v_color=a_color; v_world=p; }`;
const runoffFragment = `#version 300 es
precision highp float;
in highp vec3 v_color; in highp vec2 v_world; uniform highp int u_maskOnly; uniform highp int u_hasPaintMask; uniform highp sampler2D u_paintMask; out highp vec4 outColor;
${surfaceMaterialShader}
void main(){ vec2 uv=vec2(v_world.x,1.0-v_world.y); float paintability=u_hasPaintMask==1?texture(u_paintMask,uv).r:1.0; if(paintability<=0.001) discard; vec3 color=u_maskOnly==1?vec3(1.0):shadeSurfacePaint(v_color,uv); outColor=vec4(color,paintability); }`;

export class CanvasRenderer {
  private baseGl: WebGL2RenderingContext;
  private baseProgram: WebGLProgram;
  private displayProgram: WebGLProgram;
  private chromeProgram: WebGLProgram;
  private environmentChromeProgram: WebGLProgram;
  private mirrorBallChromeProgram: WebGLProgram;
  private environmentTexture: WebGLTexture;
  private environmentReady = false;
  private reflectionTexture: WebGLTexture;
  private reflectionReady = false;
  private chromeAssetsStarted = false;
  private environmentImage!: HTMLImageElement;
  private reflectionImage!: HTMLImageElement;
  private runoffProgram: WebGLProgram;
  private sprayProgram: WebGLProgram;
  private baseVao: WebGLVertexArrayObject;
  private runoffVao: WebGLVertexArrayObject;
  private sprayVao: WebGLVertexArrayObject;
  private dabBuffer: WebGLBuffer;
  private sprayBuffer: WebGLBuffer;
  private sprayBufferCapacity = 0;
  private readonly sprayGpuCache = new Map<SprayStroke, WebGLBuffer>();
  private readonly runoffGpuCache = new Map<object, { buffer: WebGLBuffer; geometry: Float32Array }>();
  private baseTexture: WebGLTexture;
  private paintMaskTexture: WebGLTexture;
  private paintMaskEnabled = false;
  private aoMapTexture: WebGLTexture;
  private surfaceMaterialKey = '';
  private hasAoMap = false;
  private baseFramebuffer: WebGLFramebuffer;
  private chromeMasks!: Record<ChromeMaterial, { texture: WebGLTexture; framebuffer: WebGLFramebuffer }>;
  private strokes: PaintOperation[] = [];
  private active: Stroke | null = null;
  private activeSpray: SprayStroke | null = null;
  private activeErase: Stroke | null = null;
  private incrementallyRenderedStroke: Stroke | null = null;
  private incrementallyRenderedDabCount = 0;
  private width = 1;
  private height = 1;
  private runoffEngine = new RunoffEngine();
  private raf = 0;
  private renderRaf = 0;
  private renderReplayRequired = false;
  private lastFrame = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly runoffCanvas: HTMLCanvasElement) {
    const baseGl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true });
    if (!baseGl) throw new Error('WebGL2 is not available in this browser.');
    this.baseGl = baseGl;
    this.baseProgram = this.createProgram(baseGl, dabVertex, baseFragment, 'brush dab');
    this.displayProgram = this.createProgram(baseGl, fullscreenVertex, displayFragment, 'canvas display');
    this.chromeProgram = this.createProgram(baseGl, fullscreenVertex, chromeFragment, 'chrome composite');
    this.environmentChromeProgram = this.createProgram(baseGl, fullscreenVertex, environmentChromeFragment, 'environment chrome composite');
    this.mirrorBallChromeProgram = this.createProgram(baseGl, fullscreenVertex, mirrorBallChromeFragment, 'mirror-ball chrome composite');
    this.environmentTexture = this.createTexture(baseGl);
    baseGl.bindTexture(baseGl.TEXTURE_2D, this.environmentTexture);
    baseGl.texImage2D(baseGl.TEXTURE_2D, 0, baseGl.RGBA8, 1, 1, 0, baseGl.RGBA, baseGl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    const environment = new Image();
    this.environmentImage = environment;
    environment.onload = () => {
      baseGl.bindTexture(baseGl.TEXTURE_2D, this.environmentTexture);
      baseGl.pixelStorei(baseGl.UNPACK_FLIP_Y_WEBGL, 0);
      baseGl.pixelStorei(baseGl.UNPACK_COLORSPACE_CONVERSION_WEBGL, baseGl.NONE);
      baseGl.texImage2D(baseGl.TEXTURE_2D, 0, baseGl.RGBA8, baseGl.RGBA, baseGl.UNSIGNED_BYTE, environment);
      this.environmentReady = baseGl.getError() === baseGl.NO_ERROR;
      if (this.environmentReady) this.scheduleRender(true);
    };
    environment.onerror = () => {
      this.environmentReady = false;
      this.scheduleRender(true);
    };
    this.reflectionTexture = this.createTexture(baseGl);
    baseGl.bindTexture(baseGl.TEXTURE_2D, this.reflectionTexture);
    baseGl.texImage2D(baseGl.TEXTURE_2D, 0, baseGl.R8, 1, 1, 0, baseGl.RED, baseGl.UNSIGNED_BYTE, new Uint8Array([255]));
    const reflection = new Image();
    this.reflectionImage = reflection;
    reflection.onload = () => {
      baseGl.bindTexture(baseGl.TEXTURE_2D, this.reflectionTexture);
      baseGl.pixelStorei(baseGl.UNPACK_FLIP_Y_WEBGL, 1);
      // Preserve the PNG's grayscale byte values for scalar shader sampling.
      baseGl.pixelStorei(baseGl.UNPACK_COLORSPACE_CONVERSION_WEBGL, baseGl.NONE);
      try {
        baseGl.texImage2D(baseGl.TEXTURE_2D, 0, baseGl.R8, baseGl.RED, baseGl.UNSIGNED_BYTE, reflection);
        this.reflectionReady = baseGl.getError() === baseGl.NO_ERROR;
      } catch {
        this.reflectionReady = false;
      }
      baseGl.pixelStorei(baseGl.UNPACK_FLIP_Y_WEBGL, 0);
      this.scheduleRender(true);
    };
    reflection.onerror = () => {
      this.reflectionReady = false;
      this.scheduleRender(true);
    };
    this.runoffProgram = this.createProgram(baseGl, runoffVertex, runoffFragment, 'runoff');
    this.sprayProgram = this.createProgram(baseGl, sprayVertex, sprayFragment, 'spray particles');
    const baseVao = baseGl.createVertexArray();
    const runoffVao = baseGl.createVertexArray();
    const sprayVao = baseGl.createVertexArray();
    const dabBuffer = baseGl.createBuffer();
    const sprayBuffer = baseGl.createBuffer();
    if (!baseVao || !runoffVao || !sprayVao || !dabBuffer || !sprayBuffer) throw new Error('Could not create canvas render resources.');
    this.baseVao = baseVao;
    this.runoffVao = runoffVao;
    this.sprayVao = sprayVao;
    this.dabBuffer = dabBuffer;
    this.sprayBuffer = sprayBuffer;
    this.baseTexture = this.createTexture(baseGl);
    this.paintMaskTexture = this.createTexture(baseGl);
    this.aoMapTexture = this.createTexture(baseGl);
    baseGl.bindTexture(baseGl.TEXTURE_2D, this.paintMaskTexture);
    baseGl.texImage2D(baseGl.TEXTURE_2D, 0, baseGl.RGBA8, 1, 1, 0, baseGl.RGBA, baseGl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    baseGl.bindTexture(baseGl.TEXTURE_2D, this.aoMapTexture);
    baseGl.texImage2D(baseGl.TEXTURE_2D, 0, baseGl.R8, 1, 1, 0, baseGl.RED, baseGl.UNSIGNED_BYTE, new Uint8Array([255]));
    this.baseFramebuffer = this.createFramebuffer(baseGl, this.baseTexture);
    this.chromeMasks = Object.fromEntries(chromeMaterials.map((material) => {
      const texture = this.createTexture(baseGl);
      return [material, { texture, framebuffer: this.createFramebuffer(baseGl, texture) }];
    })) as Record<ChromeMaterial, { texture: WebGLTexture; framebuffer: WebGLFramebuffer }>;
    baseGl.bindVertexArray(baseVao);
    baseGl.bindVertexArray(runoffVao);
    baseGl.disable(baseGl.BLEND);
    this.resize(1, 1, 1);
  }

  private compile(gl: WebGL2RenderingContext, type: number, source: string, stage: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error(`WebGL could not allocate the ${stage} shader.`);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || '(compiler returned no diagnostic log)';
      gl.deleteShader(shader);
      throw new Error(`WebGL ${stage} shader compilation failed.\n${log}\nShader source:\n${this.numberedSource(source)}`);
    }
    return shader;
  }

  private createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, label: string): WebGLProgram {
    const program = gl.createProgram();
    if (!program) throw new Error(`WebGL could not allocate the ${label} program.`);
    let vertexShader: WebGLShader | null = null;
    let fragmentShader: WebGLShader | null = null;
    try {
      vertexShader = this.compile(gl, gl.VERTEX_SHADER, vertex, `${label} vertex`);
      fragmentShader = this.compile(gl, gl.FRAGMENT_SHADER, fragment, `${label} fragment`);
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) || '(linker returned no diagnostic log)';
        throw new Error(`WebGL ${label} program link failed.\n${log}`);
      }
      return program;
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    } finally {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
    }
  }

  private numberedSource(source: string): string {
    return source.split('\n').map((line, index) => `${String(index + 1).padStart(3, ' ')}: ${line}`).join('\n');
  }

  private createTexture(gl: WebGL2RenderingContext): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not create base layer texture.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private ensureChromeAssets(): void {
    if (this.chromeAssetsStarted) return;
    this.chromeAssetsStarted = true;
    this.environmentImage.src = '/chrome-environment.png';
    this.reflectionImage.src = '/reflection_8bit_grayscale.png';
  }

  private createFramebuffer(gl: WebGL2RenderingContext, texture: WebGLTexture): WebGLFramebuffer {
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Could not create base layer framebuffer.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return framebuffer;
  }

  resize(width: number, height: number, dpr: number, displayWidth = width, displayHeight = height): void {
    this.width = Math.max(width, 1); this.height = Math.max(height, 1);
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    this.canvas.width = backingWidth; this.canvas.height = backingHeight;
    this.runoffCanvas.width = backingWidth; this.runoffCanvas.height = backingHeight;
    this.canvas.style.width = `${displayWidth}px`; this.canvas.style.height = `${displayHeight}px`;
    this.runoffCanvas.style.width = `${displayWidth}px`; this.runoffCanvas.style.height = `${displayHeight}px`;
    const gl = this.baseGl;
    gl.bindTexture(gl.TEXTURE_2D, this.baseTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, backingWidth, backingHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const { texture } of Object.values(this.chromeMasks)) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, backingWidth, backingHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    this.replayBase();
    this.startRunoffAnimation();
  }

  setDisplaySize(width: number, height: number): void {
    this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`;
    this.runoffCanvas.style.width = `${width}px`; this.runoffCanvas.style.height = `${height}px`;
  }

  setRunIntensity(value: number): void { this.runoffEngine.setIntensity(value); }

  setRunoffObstacles(obstacles: readonly RunoffObstacle[]): void {
    this.runoffEngine.setObstacles(obstacles);
    this.scheduleRender(false);
    this.startRunoffAnimation();
  }

  setPaintMask(source: TexImageSource | null): void {
    const gl = this.baseGl;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.paintMaskTexture);
    if (source) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      this.paintMaskEnabled = true;
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      this.paintMaskEnabled = false;
    }
    this.scheduleRender(true);
  }

  setSurfaceAoMap(aoMap: TexImageSource | null, key: string): void {
    if (this.surfaceMaterialKey === key) return;
    const gl = this.baseGl;
    const upload = (texture: WebGLTexture, source: TexImageSource | null, fallback: number): boolean => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (!source) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([fallback]));
        return false;
      }
      try {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, source);
        return gl.getError() === gl.NO_ERROR;
      } catch {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([fallback]));
        return false;
      } finally {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      }
    };
    this.hasAoMap = upload(this.aoMapTexture, aoMap, 255);
    this.surfaceMaterialKey = key;
    this.scheduleRender(true);
  }

  setActive(stroke: Stroke | null, newDabs: Dab[] = []): void {
    this.activeErase = null;
    this.active = stroke;
    if (stroke && stroke.material !== 'paint') this.ensureChromeAssets();
    if (stroke) this.activeSpray = null;
    if (this.incrementallyRenderedStroke !== stroke) {
      this.incrementallyRenderedStroke = stroke?.material === 'paint' ? stroke : null;
      this.incrementallyRenderedDabCount = 0;
    }
    if (!newDabs.length || !stroke) return;
    this.runoffEngine.addDabs(stroke, newDabs, performance.now(), this.width, this.height);
    if (stroke.material === 'paint') {
      // Draw only the dabs delivered in this batch; prior active dabs are already in the base.
      const batchStart = stroke.dabs.length - newDabs.length;
      const alreadyRenderedInBatch = Math.max(0, this.incrementallyRenderedDabCount - batchStart);
      const dabsToRender = newDabs.slice(alreadyRenderedInBatch);
      if (dabsToRender.length) this.drawBaseDabs(dabsToRender, stroke);
      this.incrementallyRenderedStroke = stroke;
      this.incrementallyRenderedDabCount = Math.max(this.incrementallyRenderedDabCount, stroke.dabs.length);
      this.scheduleRender(false);
    } else {
      this.scheduleRender(true);
    }
  }

  setActiveErase(stroke: Stroke | null, newDabs: Dab[] = []): void {
    if (this.activeErase !== stroke) this.incrementallyRenderedDabCount = 0;
    this.activeErase = stroke;
    this.active = null;
    this.activeSpray = null;
    if (stroke && newDabs.length) {
      const start = stroke.dabs.length - newDabs.length;
      const alreadyRendered = Math.max(0, this.incrementallyRenderedDabCount - start);
      const dabs = newDabs.slice(alreadyRendered);
      if (dabs.length) this.drawBaseDabs(dabs, stroke, false, true);
      this.incrementallyRenderedStroke = stroke;
      this.incrementallyRenderedDabCount = Math.max(this.incrementallyRenderedDabCount, stroke.dabs.length);
      this.scheduleRender(false);
    }
  }

  setActiveSpray(stroke: SprayStroke | null, newParticles: Float32Array = new Float32Array(0)): void {
    this.activeSpray = stroke;
    if (stroke && stroke.material !== 'paint') this.ensureChromeAssets();
    if (!stroke) return;
    if (stroke.material !== 'paint') {
      this.scheduleRender(true);
      return;
    }
    if (!newParticles.length) {
      this.scheduleRender(true);
      return;
    }
    if (this.renderReplayRequired) return;
    this.drawSprayParticles(newParticles, stroke);
    this.scheduleRender(false);
  }

  commitStroke(stroke: Stroke): void {
    this.commitOperation({ kind: 'marker', stroke });
  }

  commitOperation(operation: PaintOperation): void {
    const last = this.strokes.at(-1);
    if (last?.kind !== operation.kind || last.stroke !== operation.stroke) this.strokes.push(operation);
    this.active = null;
    this.activeErase = null;
    this.activeSpray = null;
    this.incrementallyRenderedStroke = null;
    this.incrementallyRenderedDabCount = 0;
  }

  setStrokes(strokes: Stroke[]): void {
    this.setOperations(strokes.map((stroke) => ({ kind: 'marker', stroke })));
  }

  setOperations(operations: PaintOperation[]): void {
    this.strokes = [...operations];
    const activeMarker = this.active ? [{ kind: 'marker' as const, stroke: this.active }] : [];
    const retained = [...this.strokes.filter((operation): operation is Extract<PaintOperation, { kind: 'marker' }> => operation.kind === 'marker').map((operation) => operation.stroke), ...activeMarker.map((operation) => operation.stroke)];
    const keep = this.runoffEngine.retain(retained);
    const retainedSpray = new Set(this.strokes.filter((operation): operation is Extract<PaintOperation, { kind: 'spray' }> => operation.kind === 'spray').map((operation) => operation.stroke));
    if (this.activeSpray) retainedSpray.add(this.activeSpray);
    for (const [stroke, buffer] of this.sprayGpuCache) if (!retainedSpray.has(stroke)) {
      this.baseGl.deleteBuffer(buffer);
      this.sprayGpuCache.delete(stroke);
    }
    for (const [component, cached] of this.runoffGpuCache) if (!keep.has(component)) {
      this.baseGl.deleteBuffer(cached.buffer);
      this.runoffGpuCache.delete(component);
    }
    this.replayBase();
    this.startRunoffAnimation();
  }

  clear(): void {
    this.strokes = []; this.active = null; this.activeSpray = null; this.activeErase = null; this.runoffEngine.clear();
    this.incrementallyRenderedStroke = null;
    this.incrementallyRenderedDabCount = 0;
    this.renderReplayRequired = false;
    for (const cached of this.runoffGpuCache.values()) this.baseGl.deleteBuffer(cached.buffer);
    this.runoffGpuCache.clear();
    for (const buffer of this.sprayGpuCache.values()) this.baseGl.deleteBuffer(buffer);
    this.sprayGpuCache.clear();
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.renderRaf) cancelAnimationFrame(this.renderRaf);
    this.raf = 0; this.renderRaf = 0; this.lastFrame = 0;
    this.clearBase(); this.presentBase();
  }

  private clearBase(): void {
    const gl = this.baseGl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.baseFramebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private replayBase(): void {
    this.clearBase();
    let chromeBatch = false;
    const flushChrome = (): void => {
      if (!chromeBatch) return;
      this.compositeChrome();
      chromeBatch = false;
    };
    const drawStroke = (operation: PaintOperation): void => {
      if (operation.kind === 'spray') {
        flushChrome();
        if (operation.stroke.material !== 'paint') this.clearChromeMasks();
        if (operation.stroke === this.activeSpray) this.drawSprayParticles(operation.stroke.particles, operation.stroke);
        else this.drawCachedSprayStroke(operation.stroke);
        if (operation.stroke.material !== 'paint') this.compositeChrome();
        return;
      }
      if (operation.kind === 'erase') {
        flushChrome();
        this.drawBaseDabs(operation.stroke.dabs, operation.stroke, false, true);
        return;
      }
      const stroke = operation.stroke;
      if (stroke.material !== 'paint') {
        if (!chromeBatch) {
          chromeBatch = true;
          this.clearChromeMasks();
        }
        this.drawBaseDabs(stroke.dabs, stroke, true);
        this.drawRunoffs(stroke, true);
        return;
      }
      flushChrome();
      this.drawBaseDabs(stroke.dabs, stroke);
      this.drawRunoffs(stroke);
    };
    for (const stroke of this.strokes) drawStroke(stroke);
    if (this.active) drawStroke({ kind: 'marker', stroke: this.active });
    if (this.activeSpray) drawStroke({ kind: 'spray', stroke: this.activeSpray });
    if (this.activeErase) drawStroke({ kind: 'erase', stroke: this.activeErase });
    flushChrome();
    this.presentBase();
    this.incrementallyRenderedStroke = this.active?.material === 'paint' ? this.active : null;
    this.incrementallyRenderedDabCount = this.incrementallyRenderedStroke?.dabs.length ?? 0;
  }

  private clearChromeMasks(): void {
    const gl = this.baseGl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    for (const { framebuffer } of Object.values(this.chromeMasks)) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  private compositeChrome(): void {
    const gl = this.baseGl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.baseFramebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const program = this.reflectionReady
      ? this.mirrorBallChromeProgram
      : this.environmentReady ? this.environmentChromeProgram : this.chromeProgram;
    gl.useProgram(program);
    chromeMaterials.forEach((material, index) => {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, this.chromeMasks[material].texture);
      const uniformName = material === 'silver-chrome' ? 'u_silverMask' : material === 'copper-chrome' ? 'u_copperMask' : 'u_goldMask';
      gl.uniform1i(gl.getUniformLocation(program, uniformName), index);
    });
    if (this.reflectionReady) {
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.reflectionTexture);
      gl.uniform1i(gl.getUniformLocation(program, 'u_reflectionMap'), 3);
      gl.uniform1f(gl.getUniformLocation(program, 'u_reflectionIntensity'), 1.0);
    } else if (this.environmentReady) {
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.environmentTexture);
      gl.uniform1i(gl.getUniformLocation(program, 'u_environment'), 3);
      gl.uniform1f(gl.getUniformLocation(program, 'u_reflectionIntensity'), 1.0);
    }
    gl.bindVertexArray(this.baseVao);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  private bindPaintMask(program: WebGLProgram): void {
    const gl = this.baseGl;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.paintMaskTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_paintMask'), 4);
    gl.uniform1i(gl.getUniformLocation(program, 'u_hasPaintMask'), this.paintMaskEnabled ? 1 : 0);
    const logicalSize = gl.getUniformLocation(program, 'u_logicalSize');
    if (logicalSize) gl.uniform2f(logicalSize, this.width, this.height);
  }

  private bindSurfaceMaterialMaps(program: WebGLProgram, apply: boolean): void {
    const gl = this.baseGl;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.aoMapTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_aoMap'), 5);
    gl.uniform1i(gl.getUniformLocation(program, 'u_hasAoMap'), this.hasAoMap ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_applySurfaceMaterial'), apply ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(program, 'u_surfaceAoStrength'), 0.14);
  }

  private scheduleRender(replay: boolean): void {
    this.renderReplayRequired ||= replay;
    if (this.renderRaf) return;
    this.renderRaf = requestAnimationFrame(() => {
      this.renderRaf = 0;
      const replayRequired = this.renderReplayRequired;
      this.renderReplayRequired = false;
      if (replayRequired) this.replayBase();
      else this.presentBase();
      this.startRunoffAnimation();
    });
  }

  private drawBaseDabs(dabs: Dab[], stroke: Stroke, maskOnly = false, erase = false): void {
    if (!dabs.length) return;
    const gl = this.baseGl;
    const first = dabs[0];
    const vertices = new Float32Array(dabs.length * 3);
    dabs.forEach((dab, index) => vertices.set([dab.x, dab.y, dab.angle], index * 3));
    gl.bindVertexArray(this.baseVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dabBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER, maskOnly ? this.chromeMasks[stroke.material as ChromeMaterial].framebuffer : this.baseFramebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.baseProgram);
    gl.uniform2f(gl.getUniformLocation(this.baseProgram, 'u_targetSize'), this.canvas.width, this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.baseProgram, 'u_scale'), this.canvas.width / this.width, this.canvas.height / this.height);
    gl.uniform1f(gl.getUniformLocation(this.baseProgram, 'u_brushSize'), first.size);
    gl.uniform1i(gl.getUniformLocation(this.baseProgram, 'u_shape'), stroke.shape === 'round' ? 0 : stroke.shape === 'square' ? 1 : stroke.shape === 'chisel' ? 2 : 3);
    gl.uniform1i(gl.getUniformLocation(this.baseProgram, 'u_maskOnly'), maskOnly ? 1 : 0);
    gl.uniform3fv(gl.getUniformLocation(this.baseProgram, 'u_color'), this.parseColor(first.color));
    this.bindPaintMask(this.baseProgram);
    this.bindSurfaceMaterialMaps(this.baseProgram, !maskOnly && !erase && stroke.material === 'paint');
    const attribute = gl.getAttribLocation(this.baseProgram, 'a_dab');
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 12, 0);
    gl.enable(gl.BLEND);
    if (erase) gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, dabs.length);
    gl.disable(gl.BLEND);
  }

  private drawSprayParticles(particles: Float32Array, stroke: SprayStroke): void {
    if (!particles.length) return;
    const gl = this.baseGl;
    gl.bindVertexArray(this.sprayVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sprayBuffer);
    if (particles.byteLength > this.sprayBufferCapacity) {
      this.sprayBufferCapacity = Math.max(particles.byteLength, this.sprayBufferCapacity === 0 ? 4096 : this.sprayBufferCapacity * 2);
      gl.bufferData(gl.ARRAY_BUFFER, this.sprayBufferCapacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, particles);
    this.drawSprayBuffer(this.sprayBuffer, particles.length / 4, stroke);
  }

  private drawCachedSprayStroke(stroke: SprayStroke): void {
    if (!stroke.particles.length) return;
    const gl = this.baseGl;
    let buffer = this.sprayGpuCache.get(stroke);
    if (!buffer) {
      buffer = gl.createBuffer() ?? undefined;
      if (!buffer) throw new Error('Could not allocate spray particle buffer.');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, stroke.particles, gl.STATIC_DRAW);
      this.sprayGpuCache.set(stroke, buffer);
    }
    this.drawSprayBuffer(buffer, stroke.particles.length / 4, stroke);
  }

  private drawSprayBuffer(buffer: WebGLBuffer, particleCount: number, stroke: SprayStroke): void {
    const gl = this.baseGl;
    gl.bindVertexArray(this.sprayVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, stroke.material === 'paint' ? this.baseFramebuffer : this.chromeMasks[stroke.material].framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.sprayProgram);
    gl.uniform2f(gl.getUniformLocation(this.sprayProgram, 'u_targetSize'), this.canvas.width, this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.sprayProgram, 'u_scale'), this.canvas.width / this.width, this.canvas.height / this.height);
    gl.uniform3fv(gl.getUniformLocation(this.sprayProgram, 'u_color'), this.parseColor(stroke.color));
    gl.uniform1f(gl.getUniformLocation(this.sprayProgram, 'u_nozzleAspect'), stroke.nozzle === 'calligraphy' ? 0.18 : 1.0);
    gl.uniform1f(gl.getUniformLocation(this.sprayProgram, 'u_nozzleRotation'), stroke.nozzle === 'calligraphy' ? stroke.rotation * Math.PI / 180 : 0);
    this.bindPaintMask(this.sprayProgram);
    this.bindSurfaceMaterialMaps(this.sprayProgram, stroke.material === 'paint');
    const attribute = gl.getAttribLocation(this.sprayProgram, 'a_particle');
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, 16, 0);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.vertexAttribDivisor(attribute, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, particleCount);
    gl.disable(gl.BLEND);
  }

  private drawRunoffs(stroke: Stroke, maskOnly = false): void {
    const gl = this.baseGl;
    let drawingInitialized = false;
    let position = 0;
    let color = 0;
    this.runoffEngine.forEachGeometry(stroke, (component, geometry) => {
      if (!geometry.length) return;
      if (!drawingInitialized) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, maskOnly ? this.chromeMasks[stroke.material as ChromeMaterial].framebuffer : this.baseFramebuffer);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.useProgram(this.runoffProgram);
        gl.uniform2f(gl.getUniformLocation(this.runoffProgram, 'u_resolution'), this.width, this.height);
        gl.uniform1i(gl.getUniformLocation(this.runoffProgram, 'u_maskOnly'), maskOnly ? 1 : 0);
        this.bindPaintMask(this.runoffProgram);
        this.bindSurfaceMaterialMaps(this.runoffProgram, !maskOnly && stroke.material === 'paint');
        gl.bindVertexArray(this.runoffVao);
        position = gl.getAttribLocation(this.runoffProgram, 'a_position');
        color = gl.getAttribLocation(this.runoffProgram, 'a_color');
        gl.enableVertexAttribArray(position);
        gl.enableVertexAttribArray(color);
        if (maskOnly) {
          gl.enable(gl.BLEND);
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        } else gl.disable(gl.BLEND);
        drawingInitialized = true;
      }
      let cached = this.runoffGpuCache.get(component);
      if (!cached) {
        const buffer = gl.createBuffer();
        if (!buffer) throw new Error('Could not allocate runoff geometry buffer.');
        cached = { buffer, geometry };
        this.runoffGpuCache.set(component, cached);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
      } else if (cached.geometry !== geometry) {
        cached.geometry = geometry;
        gl.bindBuffer(gl.ARRAY_BUFFER, cached.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.DYNAMIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, cached.buffer);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 20, 8);
      gl.drawArrays(gl.TRIANGLES, 0, geometry.length / 5);
    });
    if (drawingInitialized && maskOnly) gl.disable(gl.BLEND);
  }

  private startRunoffAnimation(): void {
    if (!this.runoffEngine.hasGrowingRuns() || this.raf) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.animateRunoffs);
  }

  private animateRunoffs = (now: number): void => {
    this.raf = 0;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.runoffEngine.advance(dt);
    this.replayBase();
    if (this.runoffEngine.hasGrowingRuns()) this.raf = requestAnimationFrame(this.animateRunoffs);
  };

  private presentBase(): void {
    const gl = this.baseGl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.displayProgram);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.baseTexture);
    gl.uniform1i(gl.getUniformLocation(this.displayProgram, 'u_base'), 0);
    gl.bindVertexArray(this.baseVao); gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private parseColor(hex: string): [number, number, number] {
    const normalized = hex.replace('#', '');
    return [parseInt(normalized.slice(0, 2), 16) / 255, parseInt(normalized.slice(2, 4), 16) / 255, parseInt(normalized.slice(4, 6), 16) / 255];
  }
}

export function pointerPosition(event: PointerEvent, canvas: HTMLCanvasElement, logicalWidth: number, logicalHeight: number): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? logicalWidth / rect.width : 0;
  const scaleY = rect.height > 0 ? logicalHeight / rect.height : 0;
  return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
}
