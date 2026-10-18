'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const roles=['cover','detail','function','scene'];
const filenames=['01_cover.png','02_detail.png','03_function.png','04_scene.png'];
const editorialRoles=['cover','design','detail','interior','styling','journal'];
// Work snapshots may have a different page plan from the four-page topic catalog.
// Only explicitly versioned snapshots opt in; existing topics and prompts stay intact.
function snapshotPages(snapshot){
 const version=snapshot?.schemaVersion??1;
 if(version!==1&&version!==2)throw new Error('作品快照版本无效');
 const expected=version===2?editorialRoles:roles;
 if(!Array.isArray(snapshot.pages)||snapshot.pages.length!==expected.length)throw new Error(`作品快照需要${expected.length}张图片`);
 const seen=new Set();
 return snapshot.pages.map((page,index)=>{
  if(!page||page.role!==expected[index]||typeof page.title!=='string'||!page.title.trim()||typeof page.prompt!=='string'||!page.prompt.trim())throw new Error(`作品第${index+1}张信息不完整`);
  const filename=page.filename??(version===1?filenames[index]:null);
  if(typeof filename!=='string'||!/^\d{2}_[a-z][a-z0-9_-]*\.png$/.test(filename)||filename.length>80||seen.has(filename))throw new Error(`作品第${index+1}张图片文件名无效或重复`);
  seen.add(filename);
  return {...page,index:index+1,filename};
 });
}
const categoryRules={
 bag:'准确锁定包身轮廓、尺寸比例、包底、主开合、提手数量和锚点。内部插袋与外部造型一致，肩带必须连接到合理锚点；上身比例符合设定。不得凭图宣称防水、减压、承重、容量测试或真实使用效果。',
 phone:'以本题设计档案为准锁定手机壳或随身小物的轮廓、开孔、图案和配件连接。手机壳使用一致的无品牌通用机身示意，不能冒充适配某款真实机型；接到真实产品合作后必须使用该产品参考，不擅改开孔。画出可信厚度、边框和装饰工艺，不声称防摔、磁吸兼容或散热等未经验证性能。',
 wear:'锁定衣物版型、衣长、领口、袖口、接缝、口袋和闭合方式；正背面及穿着图保持同款结构。面料垂坠与重力合理，衣服不能与身体融合，成年人物比例自然。不承诺显瘦、显高、适合所有体型或未实测的舒适度。',
 home:'这是局部空间概念，不是已竣工案例。锁定门窗位置、墙体轮廓、家具数量、材质及布局，各视角必须是同一个空间。比例、通行和开合方向合理，灯光有实际来源；不画穿墙家具或虚假扩大空间。不输出施工安全、承重、电气或结构改造结论。',
 daily:'这是独立日常小物的概念设计。锁定单件物品的轮廓、部件数量、材质、配色、纹样和连接方式；四页呈现同款。结构图展示实际设定的开合、摆放、握持或部件关系，不添加未设定的机关；接触与支撑符合重力，手指、杯口、接缝等比例自然。道具只辅助说明，不能淹没主物件。不将概念图当作实测，不宣称已验证的食品接触安全、耐热、耐重、抗菌、助眠或其他性能。'
};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const length=s=>[...s].length;
function validateTopic(t){
 const bad=message=>{throw new Error(`${t?.id||'选题'}：${message}`)};
 if(!/^DS\d{3}$/.test(t?.id))bad('编号无效');
 if(!categoryRules[t.category])bad('分类无效');
 for(const key of ['title','theme','scene','hook','audience','caption'])if(typeof t[key]!=='string'||!t[key].trim())bad(`缺少${key}`);
 if(length(t.title)>20)bad('标题超过20字');
 if(!Array.isArray(t.tags)||!t.tags.length||t.tags.length>10||t.tags.some(s=>typeof s!=='string'||!s.trim()||s.length>30||s.includes('#')))bad('标签格式无效');
 if(length(t.caption+'\n'+t.tags.map(s=>'#'+s).join(' '))>1000)bad('正文和标签超过1000字');
 if(!t.design||typeof t.design.silhouette!=='string'||!t.design.silhouette.trim())bad('缺少设计轮廓');
 for(const key of ['materials','palette','features'])if(!Array.isArray(t.design[key])||!t.design[key].length||t.design[key].some(s=>typeof s!=='string'||!s.trim()))bad(`缺少设计${key}`);
 if(!Array.isArray(t.pages)||t.pages.length!==4)bad('必须有四张图');
 t.pages.forEach((p,i)=>{if(p.role!==roles[i]||typeof p.title!=='string'||!p.title.trim()||typeof p.focus!=='string'||!p.focus.trim())bad(`第${i+1}张图信息不完整`)});
 return t;
}
function makePrompt(topic,page,index,profile){
 return `用途：小红书原创概念设计组图，第${index+1}/4张。只生成本张独立图片，竖版3:4，建议1086×1448像素。\n`+
 `账号：${profile.name}。视觉方向：${profile.visualDirection}\n`+
 `主题：${topic.theme}\n面向：${topic.audience}\n生活场景：${topic.scene}\n`+
 `【同款设计档案，四张图保持一致】\n轮廓：${topic.design.silhouette}\n材质设想：${topic.design.materials.join('；')}\n配色：${topic.design.palette.join('；')}\n设计细节：${topic.design.features.join('；')}\n`+
 `【本品类绘制要求】${categoryRules[topic.category]}\n`+
 (index===0?'【主视觉】本张确定这一款的外观基准。物品或空间为主体，缩略图中轮廓与设计特点仍清楚；用真实材质感、自然光影和少量留白，避免夸张奇观。\n':'【参考与一致性】必须实际传入已确认的01_cover.png作为产品参考，先看参考图，再绘制本张。保留同款轮廓、配色、材质、结构和连接方式，只改变指定视角或场景；不可重新设计。\n')+
 `【本张专属画面】${page.focus}\n`+
 `【图中可见文字，仅以下内容】小字署名“${profile.name}”；短标题“${page.title}”；页脚“${profile.disclosure}”。中文排版清楚，标题不遮挡主体。图上不放正文段落或绘制指令。\n`+
 '【限制】不出现现成品牌logo、授权不明角色、价格、购买按钮或虚构客户合作。人物只用成年自然体态，不让模特抢走物品主体。所有效果为概念展示，不冒充实物照片、真实亲测、量产样品或已施工项目。\n';
}
function compileTopic(input,profile){const t=validateTopic(structuredClone(input));t.pages=t.pages.map((p,i)=>({...p,filename:filenames[i],prompt:typeof p.prompt==='string'&&p.prompt.trim()?p.prompt:makePrompt(t,p,i,profile)}));return t}
function loadCatalog(root){
 const dir=path.join(root,'config','design-studio'),profile=read(path.join(dir,'profile.json'));
 const files=fs.readdirSync(dir).filter(name=>/^topics-[a-z0-9-]+\.json$/.test(name)).sort();
 const topics=files.flatMap(name=>read(path.join(dir,name))).map(t=>compileTopic(t,profile));
 const ids=new Set(),titles=new Set();for(const t of topics){if(ids.has(t.id)||titles.has(t.title))throw new Error('选题编号或标题重复：'+t.id);ids.add(t.id);titles.add(t.title)}
 return {profile,topics:topics.sort((a,b)=>a.id.localeCompare(b.id))};
}
module.exports={loadCatalog,compileTopic,makePrompt,validateTopic,snapshotPages,hash,filenames,categoryRules};
