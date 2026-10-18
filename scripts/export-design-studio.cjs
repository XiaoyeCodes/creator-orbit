'use strict';
// Export the complete shipped drafts without starting or changing generation jobs.
const fs=require('node:fs'),path=require('node:path');
const {loadCatalog}=require('../lib/design-studio-content.cjs');
const root=path.resolve(__dirname,'..'),catalog=loadCatalog(root);
const expected=catalog.profile.categories.reduce((n,c)=>n+c.target,0);
if(catalog.topics.length!==expected)throw new Error('选题尚未齐备：'+catalog.topics.length+'/'+expected);
const folder=path.join(root,'data','design-studio','catalog-export');
fs.mkdirSync(folder,{recursive:true});
function exportBundle(topics,prefix){
 const prompts=topics.reduce((n,t)=>n+t.pages.length,0),name=prefix+topics.length+'题完整文案与'+prompts+'条图片提示词';
 fs.writeFileSync(path.join(folder,name+'.json'),JSON.stringify({...catalog,topics},null,2),'utf8');
 const sections=topics.map(t=>[
 `## ${t.id} · ${t.title}`,
 `分类：${catalog.profile.categories.find(c=>c.id===t.category).name}｜建议批次：${t.priority}`,
 `主题：${t.theme}\n\n场景：${t.scene}\n\n目标读者：${t.audience}\n\n内容切入点：${t.hook}`,
 `### 发布文案\n\n${t.title}\n\n${t.caption}\n\n${t.tags.map(s=>'#'+s).join(' ')}`,
 ...t.pages.map((p,i)=>`### 图片 ${i+1} · ${p.title}\n\n\`\`\`text\n${p.prompt}\`\`\``)
].join('\n\n'));
fs.writeFileSync(path.join(folder,name+'.md'),[
 '# 偏爱日常设计所 · '+prefix+topics.length+'个选题完整内容包',
 '预置稿件备份。'+catalog.profile.categories.map(c=>({name:c.name,count:topics.filter(t=>t.category===c.id).length})).filter(c=>c.count).map(c=>c.name+c.count+'题').join('、')+'；每题四张独立3:4图。优先级是发布测试顺序，不是效果预测。',
 '文件包含完整文案与提示词，图片需要逐题生成。网站内编辑过的最新版请用工作台“导出选题库”另行导出。',
 ...sections
].join('\n\n'),'utf8');
}
exportBundle(catalog.topics,'');
for(const collection of catalog.profile.collections||[]){const subset=catalog.topics.filter(t=>t.collection===collection.id);if(subset.length!==collection.expected)throw new Error(collection.name+'尚未齐备');exportBundle(subset,'新增_'+collection.name+'_')}
console.log(JSON.stringify({topics:catalog.topics.length,prompts:catalog.topics.reduce((n,t)=>n+t.pages.length,0),folder}));
