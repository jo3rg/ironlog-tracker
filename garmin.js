/* Garmin strength workout FIT export. Dependency-free, suitable for the offline PWA. */
(function (root) {
  'use strict';

  const EPOCH = 631065600;
  const CRC_TABLE = [0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400];
  function crc16(crc, byte) {
    let t = CRC_TABLE[crc & 15]; crc = (crc >>> 4) & 0x0FFF; crc ^= t ^ CRC_TABLE[byte & 15];
    t = CRC_TABLE[crc & 15]; crc = (crc >>> 4) & 0x0FFF; return (crc ^ t ^ CRC_TABLE[(byte >>> 4) & 15]) & 0xFFFF;
  }
  function crc(bytes) { let c = 0; for (const b of bytes) c = crc16(c, b); return c; }
  const enc = new TextEncoder();
  class Writer {
    constructor() { this.bytes = []; }
    u8(v) { this.bytes.push(v & 255); return this; }
    u16(v) { this.bytes.push(v & 255, (v >>> 8) & 255); return this; }
    u32(v) { this.bytes.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); return this; }
    raw(a) { for (const v of a) this.bytes.push(v & 255); return this; }
  }
  const U8=2, U16=0x84, U32=0x86, STR=7;
  const defs = {
    0:{order:[1,2,3,4,0],fields:{0:[1,U8,'enum'],1:[2,U16,'uint16'],2:[2,U16,'uint16'],3:[4,0x8C,'uint32z'],4:[4,U32,'uint32']}},
    26:{order:[8,4,11,6],fields:{4:[1,U8,'enum'],6:[2,U16,'uint16'],8:[1,STR,'string'],11:[1,U8,'enum']}},
    27:{order:[254,0,7,1,2,3,4,8,10,11,12,13],fields:{0:[1,STR,'string'],1:[1,U8,'enum'],2:[4,U32,'uint32'],3:[1,U8,'enum'],4:[4,U32,'uint32'],7:[1,U8,'enum'],8:[1,STR,'string'],10:[2,U16,'uint16'],11:[2,U16,'uint16'],12:[2,U16,'uint16'],13:[2,U16,'uint16'],254:[2,U16,'uint16']}},
    264:{order:[254,0,1,2],fields:{0:[2,U16,'uint16'],1:[2,U16,'uint16'],2:[1,STR,'string'],254:[2,U16,'uint16']}}
  };
  function writeValue(w, type, value, size) {
    if (type === 'enum' || type === 'uint8') w.u8(value);
    else if (type === 'uint16') w.u16(value);
    else if (type === 'uint32' || type === 'uint32z') w.u32(value);
    else if (type === 'string') { const b=enc.encode(String(value)); if (b.length+1>size) throw new Error('FIT string overflow'); w.raw(b).u8(0); for(let i=b.length+1;i<size;i++) w.u8(0); }
    else throw new Error('Unsupported FIT field type: '+type);
  }
  class FitFile {
    constructor() { this.messages=[]; }
    mesg(globalNum, fields) { this.messages.push({globalNum,fields:fields.filter(([,v])=>v!==undefined&&v!==null)}); return this; }
    build() {
      const definitions=new Map(); let local=0; const w=new Writer();
      for(const m of this.messages) {
        const defn=defs[m.globalNum], nums=m.fields.map(([n])=>n), sizes={};
        if(!defn||!nums.length) throw new Error('Invalid FIT message '+m.globalNum);
        for(const n of nums) { const fd=defn.fields[n]; if(!fd) throw new Error('Unknown FIT field '+m.globalNum+':'+n); sizes[n]=fd[2]==='string'?enc.encode(String(m.fields.find(([x])=>x===n)[1])).length+1:fd[0]; }
        const key=m.globalNum+'|'+nums.map(n=>n+':'+sizes[n]).join(','); let d=definitions.get(key);
        if(!d) {
          d={local:local++&15,globalNum:m.globalNum,nums,sizes}; definitions.set(key,d);
          w.u8(0x40|d.local).u8(0).u8(0).u16(d.globalNum).u8(nums.length);
          for(const n of nums) { const fd=defn.fields[n]; w.u8(n).u8(sizes[n]).u8(fd[1]); }
        }
        w.u8(d.local);
        for(const n of nums) { const fd=defn.fields[n], val=m.fields.find(([x])=>x===n)[1]; writeValue(w,fd[2],val,sizes[n]); }
      }
      const h=new Writer(); h.u8(14).u8(2).u16(21218).u32(w.bytes.length).raw([0x2E,0x46,0x49,0x54]); h.u16(crc(h.bytes));
      const out=new Uint8Array(h.bytes.length+w.bytes.length+2); out.set(h.bytes); out.set(w.bytes,h.bytes.length);
      const c=crc(out.subarray(0,h.bytes.length+w.bytes.length)); out[out.length-2]=c&255; out[out.length-1]=c>>>8; return out;
    }
  }
  const E={fileWorkout:5,sportTraining:10,subSportStrength:20,intensityActive:0,intensityRest:1,durationTime:0,durationRepeat:6,durationReps:29,targetOpen:2,unknown:65534,kilogram:1};
  const MAP={
    'bankdrücken langhantel':[0,1], 'schrägbankdrücken langhantel':[0,8], 'kurzhantel schrägbank':[0,9],
    'schulterdrücken kurzhantel':[24,24], 'bizeps curl lh':[7,3], 'hammer curl':[7,16],
    'trizeps pushdown':[30,19], 'french press':[30,13], 'rudern t-bar oder lh':[23,28],
    'langhantelrudern (pendlay)':[23,45], 'klimmzüge':[21,38],
    'lat-pulldown eng (v-griff)':[21,5], 'face pulls':[23,5], 'kniebeugen langhantel':[28,6],
    'back squat':[28,6], 'beinpresse':[28,0], 'bulgarian split squat':[28,28],
    'kreuzheben konventionell':[8,0], 'rumänisches kreuzheben':[8,23], 'hip thrust langhantel':[10,1],
    'beinbeuger liegend':[15,0], 'wadenheben stehend':[1,18], 'wadenheben sitzend':[1,6],
    'hängendes beinheben':[16,1], 'plank':[19,43], 'liegestütze':[22,77], 'burpees':[29,0],
    'kettlebell swings':[10,23], 'seitheben kurzhantel':[14,34]
  };
  function mapExercise(name, index) {
    const key=String(name||'').trim().toLocaleLowerCase('de');
    const hit=MAP[key];
    return hit ? {category:hit[0],code:hit[1],mapped:true} : {category:E.unknown,code:1000+(index||0),mapped:false};
  }
  function repsTarget(value) { const m=String(value||'').match(/\d+/); return m ? Math.max(1,Number(m[0])) : 8; }
  function lastWeight(history, ex) {
    for(let i=(history||[]).length-1;i>=0;i--) {
      const found=(history[i].exercises||[]).find(x=>(ex.id&&x.id===ex.id)||String(x.name||'').toLowerCase()===String(ex.name||'').toLowerCase());
      if(found) for(let j=(found.sets||[]).length-1;j>=0;j--) { const n=Number(found.sets[j].w); if(Number.isFinite(n)&&n>0) return n; }
    }
    return undefined;
  }
  function planToWorkout(day, history, options) {
    if(!day) throw new Error('Kein Trainingstag ausgewählt.');
    if(day.format && day.format!=='standard') throw new Error('Garmin-Export unterstützt aktuell nur Krafttrainingspläne, keine WOD-Formate.');
    const withRest=!(options&&options.restSteps===false);
    const exercises=(day.exercises||[]).map((ex,i)=>{
      const timed=/(?:time_s|time|duration)/i.test((ex.metrics||[]).join(',')) || /s\s*$/i.test(String(ex.reps||''));
      const seconds=Number((String(ex.reps||'').match(/\d+/)||[])[0])||45;
      const mapped=mapExercise(ex.name,i);
      return {id:ex.id,name:ex.name||ex.id,category:mapped.category,code:mapped.code,mapped:mapped.mapped,
        sets:Math.max(1,Math.min(99,Number(ex.sets)||1)),reps:repsTarget(ex.reps),timed,durationSec:seconds,
        weight:lastWeight(history,ex),rest:withRest?Math.max(0,Number(ex.rest)||0):0,notes:ex.cues||''};
    });
    if(!exercises.length) throw new Error('Dieser Trainingstag enthält keine Übungen.');
    return {name:String(day.name||day.code||'IRON.LOG').slice(0,32),dayCode:day.code||'',exercises};
  }
  function workoutToFit(workout) {
    const f=new FitFile(), steps=[], titles=[]; let idx=0;
    f.mesg(0,[[1,255],[2,1],[3,0x1234],[4,Math.round(Date.now()/1000)-EPOCH],[0,E.fileWorkout]]);
    workout.exercises.forEach((ex,exIdx)=>{
      titles.push({category:ex.category,code:ex.code,text:ex.name});
      const first=idx;
      const step=[[254,idx],[0,ex.name],[7,E.intensityActive],[1,ex.timed?E.durationTime:E.durationReps],[2,ex.timed?ex.durationSec*1000:ex.reps],[3,E.targetOpen],[8,ex.notes],[10,ex.category],[11,ex.code]];
      if(ex.weight>0) step.push([12,Math.round(ex.weight*100)],[13,E.kilogram]);
      steps.push(step); idx++;
      if(ex.rest>0) { steps.push([[254,idx],[0,'Pause'],[7,E.intensityRest],[1,E.durationTime],[2,ex.rest*1000],[3,E.targetOpen]]); idx++; }
      if(ex.sets>1) { steps.push([[254,idx],[0,`${ex.sets}× ${ex.name}`],[1,E.durationRepeat],[2,first],[3,E.targetOpen],[4,ex.sets]]); idx++; }
      if(exIdx<workout.exercises.length-1&&ex.rest>0) { steps.push([[254,idx],[0,'Übungswechsel'],[7,E.intensityRest],[1,E.durationTime],[2,Math.min(ex.rest,60)*1000],[3,E.targetOpen]]); idx++; }
    });
    f.mesg(26,[[8,workout.name],[4,E.sportTraining],[11,E.subSportStrength],[6,steps.length]]);
    steps.forEach(s=>f.mesg(27,s));
    titles.forEach((t,i)=>f.mesg(264,[[254,i],[0,t.category],[1,t.code],[2,t.text]]));
    return f.build();
  }
  function exportWorkout(day, history) {
    const workout=planToWorkout(day,history), bytes=workoutToFit(workout);
    const blob=new Blob([bytes],{type:'application/vnd.ant.fit'}), url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download='ironlog-'+String(day.code||'workout').toLowerCase().replace(/[^a-z0-9_-]/g,'-')+'.fit'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return {bytes:bytes.length,unmapped:workout.exercises.filter(x=>!x.mapped).map(x=>x.name),workout};
  }
  const TYPE_SIZE={0:1,1:1,2:1,3:2,4:2,5:4,6:4,7:1,8:4,9:8,10:1,11:2,12:4,13:1,14:8,15:8,16:8};
  function fitValue(view, offset, size, base, little) {
    const type=base&31, width=TYPE_SIZE[type];
    if(type===7) {
      let end=offset; while(end<offset+size&&view.getUint8(end)!==0) end++;
      return new TextDecoder().decode(new Uint8Array(view.buffer,view.byteOffset+offset,end-offset));
    }
    if(!width||size%width) return null;
    const values=[];
    for(let p=offset;p<offset+size;p+=width) {
      let v;
      switch(type) {
        case 0: case 2: case 10: v=view.getUint8(p); break;
        case 1: v=view.getInt8(p); break;
        case 3: v=view.getInt16(p,little); break;
        case 4: case 11: v=view.getUint16(p,little); break;
        case 5: v=view.getInt32(p,little); break;
        case 6: case 12: v=view.getUint32(p,little); break;
        case 8: v=view.getFloat32(p,little); break;
        case 9: v=view.getFloat64(p,little); break;
        case 13: v=view.getUint8(p); break;
        case 14: v=Number(view.getBigInt64(p,little)); break;
        case 15: case 16: v=Number(view.getBigUint64(p,little)); break;
        default: v=null;
      }
      const invalid=(type===0||type===2||type===10)?255:
        (type===3||type===4||type===11)?65535:
        (type===5||type===6||type===12)?4294967295:
        (type===14||type===15||type===16)?Number.MAX_SAFE_INTEGER:null;
      if(v!==null&&v!==invalid&&Number.isFinite(v)) values.push(v);
    }
    if(!values.length) return null;
    return size===width?values[0]:values;
  }
  function decodeFit(input) {
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(bytes.length<14) throw new Error('Die Datei ist zu klein für eine FIT-Datei.');
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const headerSize=bytes[0];
    if((headerSize!==12&&headerSize!==14)||String.fromCharCode(...bytes.subarray(8,12))!=='.FIT')
      throw new Error('Keine gültige Garmin-FIT-Datei.');
    const dataSize=v.getUint32(4,true), dataEnd=headerSize+dataSize;
    if(dataEnd+2>bytes.length) throw new Error('Die FIT-Datei ist unvollständig.');
    if(headerSize===14&&crc(bytes.subarray(0,12))!==v.getUint16(12,true))
      throw new Error('Die FIT-Datei hat einen ungültigen Header-CRC.');
    if(crc(bytes.subarray(0,dataEnd))!==v.getUint16(dataEnd,true))
      throw new Error('Die FIT-Datei hat einen ungültigen Datei-CRC.');
    const definitions=new Map(), messages=new Map();
    let p=headerSize,lastTimestamp=null;
    while(p<dataEnd) {
      const h=bytes[p++], compressed=(h&0x80)!==0, local=compressed?((h>>>5)&3):(h&15);
      if(!compressed&&(h&0x40)) {
        if(p+5>dataEnd) throw new Error('Ungültige FIT-Definition.');
        p++; const architecture=bytes[p++], little=architecture===0;
        const global=little?v.getUint16(p,true):v.getUint16(p,false); p+=2;
        const count=bytes[p++], fields=[];
        if(p+count*3>dataEnd) throw new Error('Abgeschnittene FIT-Definition.');
        for(let i=0;i<count;i++) { fields.push({num:bytes[p],size:bytes[p+1],base:bytes[p+2]}); p+=3; }
        let developers=[];
        if(h&0x20) {
          if(p>=dataEnd) throw new Error('Abgeschnittene FIT-Definition.');
          const n=bytes[p++];
          if(p+n*3>dataEnd) throw new Error('Abgeschnittene FIT-Definition.');
          for(let i=0;i<n;i++) { developers.push({size:bytes[p+1]}); p+=3; }
        }
        definitions.set(local,{global,little,fields,developers});
        continue;
      }
      const def=definitions.get(local);
      if(!def) throw new Error('FIT-Datensatz ohne Definition.');
      if(compressed&&def.global!==20) throw new Error('Nicht unterstützter komprimierter FIT-Datensatz.');
      const fields={};
      if(compressed) {
        const offset=h&31;
        if(lastTimestamp===null) throw new Error('FIT-Zeitstempel fehlt vor komprimiertem Datensatz.');
        let ts=(lastTimestamp&~31)|offset; if(ts<lastTimestamp) ts+=32;
        fields[253]=ts; lastTimestamp=ts;
      }
      for(const field of def.fields) {
        if(compressed&&field.num===253) continue;
        if(p+field.size>dataEnd) throw new Error('Abgeschnittener FIT-Datensatz.');
        fields[field.num]=fitValue(v,p,field.size,field.base,def.little); p+=field.size;
        if(field.num===253&&Number.isFinite(fields[253])) lastTimestamp=fields[253];
      }
      for(const dev of def.developers) { if(p+dev.size>dataEnd) throw new Error('Abgeschnittenes FIT-Developerfeld.'); p+=dev.size; }
      if([0,18,20,26,27,34,225,264].includes(def.global)) {
        const list=messages.get(def.global)||[]; list.push(fields); messages.set(def.global,list);
      }
    }
    return messages;
  }
  function first(value) { return Array.isArray(value)?value[0]:value; }
  function fitIso(seconds) {
    if(!Number.isFinite(seconds)) return null;
    return new Date((seconds+EPOCH)*1000).toISOString();
  }
  const CATEGORY_FALLBACK={0:'Bankdrücken',1:'Wadenheben',2:'Kardio',5:'Core',7:'Bizeps Curl',8:'Kreuzheben',10:'Hüftstreckung',14:'Seitheben',15:'Beinbeuger',16:'Beinheben',17:'Ausfallschritt',19:'Plank',21:'Klimmzüge',22:'Liegestütze',23:'Rudern',24:'Schulterdrücken',28:'Kniebeuge',29:'Ganzkörper',30:'Trizeps'};
  function exerciseName(category, code, titleMap, stepMap, stepIndex) {
    const key=String(category)+':'+String(code);
    return titleMap.get(key)||stepMap.get(stepIndex)||[...Object.entries(MAP)].find(([,pair])=>pair[0]===category&&pair[1]===code)?.[0]||CATEGORY_FALLBACK[category]||`Garmin exercise ${category}/${code}`;
  }
  function parseActivityFit(input, plans) {
    const messages=decodeFit(input);
    const fileId=(messages.get(0)||[])[0], sessions=messages.get(18)||[], session=sessions.find(s=>first(s[5])===10&&first(s[6])===20)||sessions[0];
    if(fileId&&first(fileId[0])!==4) throw new Error('Das ist eine FIT-Workout-Datei, keine abgeschlossene Aktivität.');
    if(!session||first(session[5])!==10||first(session[6])!==20) throw new Error('Die FIT-Datei enthält keine Garmin-Krafttrainingsaktivität.');
    const sets=messages.get(225)||[];
    const active=sets.filter(s=>first(s[5])===1&&(Number.isFinite(first(s[3]))||Number.isFinite(first(s[4]))||Number.isFinite(first(s[0]))));
    if(!active.length) throw new Error('In der FIT-Datei wurden keine aktiven Kraftsätze gefunden.');
    const titleMap=new Map(), stepMap=new Map();
    (messages.get(264)||[]).forEach(t=>titleMap.set(`${first(t[0])}:${first(t[1])}`,t[2]));
    (messages.get(27)||[]).forEach(s=>stepMap.set(first(s[254]),s[0]));
    const workoutName=first((messages.get(26)||[])[0]?.[8])||'';
    const groupMap=new Map(), exercises=[];
    active.forEach(s=>{
      const category=first(s[7]), code=first(s[8]), stepIndex=first(s[11]);
      const name=exerciseName(category,code,titleMap,stepMap,stepIndex);
      const key=stepIndex!==null&&stepIndex!==undefined?`step:${stepIndex}`:`exercise:${category}:${code}:${name}`;
      let ex=groupMap.get(key);
      if(!ex) {
        ex={id:null,name,sets:[]};
        const normalized=String(name).trim().toLocaleLowerCase('de');
        for(const plan of plans||[]) for(const day of plan.days||[]) {
          const match=(day.exercises||[]).find(e=>String(e.name||'').trim().toLocaleLowerCase('de')===normalized);
          if(match) { ex.id=match.id; break; }
        }
        groupMap.set(key,ex); exercises.push(ex);
      }
      const weight=first(s[4]);
      const set={};
      if(Number.isFinite(weight)) set.w=weight/16;
      const reps=first(s[3]), duration=first(s[0]);
      if(Number.isFinite(reps)) set.r=reps;
      else if(Number.isFinite(duration)) set.time_s=duration/1000;
      const start=first(s[6]); if(Number.isFinite(start)) set.startTime=fitIso(start);
      ex.sets.push(set);
    });
    const activity=(messages.get(34)||[])[0]||{};
    // UTC-Zeitstempel bevorzugen: Feld 5 der activity-Message ist lokale Zeit ohne Zeitzone.
    const start=[first(session[2]),first(activity[253]),first(active[0][6]),first(activity[5])]
      .find(t=>Number.isFinite(t)&&t>=100000000);
    const timestamp=fitIso(start), date=timestamp&&timestamp.slice(0,10);
    if(!date) throw new Error('Kein Startzeitpunkt in der FIT-Datei.');
    const heartRates=(messages.get(20)||[]).map(r=>first(r[3])).filter(Number.isFinite);
    const avgHR=first(session[16])||(heartRates.length?Math.round(heartRates.reduce((a,b)=>a+b,0)/heartRates.length):null);
    const allDays=(plans||[]).flatMap(p=>(p.days||[]).map(d=>({plan:p,day:d})));
    const workoutPlan=allDays.find(x=>x.day.name===workoutName||x.day.code===workoutName);
    let inferredPlan=workoutPlan;
    if(!inferredPlan) {
      const names=new Set(exercises.map(e=>e.name.trim().toLocaleLowerCase('de')));
      const scored=allDays.map(x=>({ ...x,score:(x.day.exercises||[]).filter(e=>names.has(String(e.name||'').trim().toLocaleLowerCase('de'))).length }))
        .sort((a,b)=>b.score-a.score);
      if(scored[0]?.score>=2) inferredPlan=scored[0];
    }
    const sessionDuration=first(session[8]);
    return {
      date,timestamp,dayCode:inferredPlan?.day.code||'',dayName:workoutName||inferredPlan?.day.name||'Garmin Krafttraining',format:'standard',
      exercises,garmin:{source:'FIT import',workoutName:workoutName||null,durationSec:Number.isFinite(sessionDuration)&&sessionDuration<=86400000?sessionDuration/1000:null,
        calories:first(session[11])??null,avgHR:avgHR??null,maxHR:first(session[17])??null,totalSets:active.length}
    };
  }
  function fingerprint(bytes) {
    let a=2166136261,b=3339675911;
    for(const x of bytes) { a=Math.imul(a^x,16777619); b=Math.imul(b^x,2246822519); }
    return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  async function importActivityFile(file, history, plans) {
    const bytes=new Uint8Array(await file.arrayBuffer()), id=fingerprint(bytes);
    const entry=parseActivityFit(bytes,plans);
    entry.garmin.fitId=id;
    entry.garmin.fileName=String(file.name||'').slice(0,120);
    if((history||[]).some(w=>w.garmin?.fitId===id)) return {duplicate:true,entry};
    return {duplicate:false,entry};
  }
  
  root.GarminAdapter={mapExercise,planToWorkout,workoutToFit,exportWorkout,decodeFit,parseActivityFit,importActivityFile};
})(window);
