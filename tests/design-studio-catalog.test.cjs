'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loadCatalog,filenames}=require('../lib/design-studio-content.cjs');
test('the complete studio ships 200 distinct drafts, including 60 new clothing and 40 daily objects',()=>{
 const {profile,topics}=loadCatalog(path.resolve(__dirname,'..'));
 assert.equal(topics.length,200);assert.deepEqual(topics.map(t=>t.id),Array.from({length:200},(_,i)=>'DS'+String(i+1).padStart(3,'0')));
 assert.deepEqual(Object.fromEntries(profile.categories.map(c=>[c.id,topics.filter(t=>t.category===c.id).length])),{bag:40,phone:30,wear:75,home:15,daily:40});
 assert.equal(new Set(topics.map(t=>t.title)).size,200);assert.equal(new Set(topics.map(t=>t.caption)).size,200);
 assert.equal(new Set(topics.flatMap(t=>t.pages.map(p=>p.prompt))).size,800);
 const added=topics.filter(t=>t.collection==='wardrobe-and-joy');assert.equal(added.length,100);assert.equal(added.filter(t=>t.category==='wear').length,60);assert.equal(added.filter(t=>t.category==='daily').length,40);assert.deepEqual(added.map(t=>t.id),topics.slice(100).map(t=>t.id));
 for(const t of added.filter(t=>t.category==='daily'))for(const p of t.pages){assert.match(p.prompt,/独立日常小物/);assert.doesNotMatch(p.prompt,/锁定门窗位置/)}
 for(const t of topics){
  assert.ok(['首批','常青','探索'].includes(t.priority),t.id);assert.ok(t.caption.length>=120,t.id+' needs finished copy');
  assert.match(t.caption,/概念/,t.id);assert.match(t.caption,/AI/i,t.id);
  assert.ok(t.tags.length>=5,t.id);assert.ok(t.design.features.length>=3,t.id);
  t.pages.forEach((p,i)=>{assert.equal(p.filename,filenames[i]);assert.ok(p.focus.length>=25,t.id+' per-page focus');assert.ok(p.prompt.length>500,t.id+' complete prompt');assert.ok(p.prompt.includes(t.design.silhouette));assert.ok(p.prompt.includes(p.focus));assert.ok(p.prompt.includes(profile.disclosure));assert.doesNotMatch(p.prompt,/\{\{[^}]+\}\}/);if(i)assert.ok(p.prompt.includes('01_cover.png'));});
 }
});
