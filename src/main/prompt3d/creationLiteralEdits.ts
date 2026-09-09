import type { CreationEdit } from "../../shared/creationFlow";

const words:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,half:.5};
const number="(-?\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|half)";
const amount=(text:string)=>words[text.toLowerCase()]??Number(text);

export function creationEditClauses(prompt:string,action:CreationEdit["action"]):string[]{
  const clauses=prompt.split(/[.;](?!\d)|,\s*(?=(?:then\s+)?(?:move|shift|translate|reposition|rotate|turn|tilt|make|scale|resize|paint|remove|delete|duplicate|copy|clone|rename|add|insert|place|save)\b)|\band\s+(?=(?:then\s+)?(?:move|shift|translate|reposition|rotate|turn|tilt|make|scale|resize|paint|remove|delete|duplicate|copy|clone|rename|add|insert|place|save)\b)/i);
  const pattern=action==="add"?/\b(add|insert|place)\b/i:action==="move"?/\b(move|shift|translate|reposition)\b/i:action==="rotate"?/\b(rotate|turn|tilt)\b/i:action==="scale"?/\b(twice|double|half|halve|triple|scale|resize|wider|taller|longer|shorter|smaller|larger|narrower)\b|\d\s*%/i:action==="duplicate"?/^\s*(?:then\s+)?(?:please\s+)?(?:duplicate|copy|clone)\b/i:action==="rename"?/\brename\b/i:action==="remove"?/\b(remove|delete)\b/i:action==="clear-animation"?/\b(remove|clear|strip|delete)\b/i:/\b(paint|colou?r|red|blue|green|brown)\b/i;
  return clauses.filter(clause=>pattern.test(clause));
}

/** The model resolves intent/parts; explicit units, directions and ratios bind execution. */
export function bindLiteralCreationEdit(edit:CreationEdit,prompt:string):CreationEdit {
  const result=structuredClone(edit);
  if(edit.action==="add"&&result.parts?.length===1){
    const part=result.parts[0];
    const name=/\b(?:named|called)\s+["“]?([a-z][\w -]{0,79}?)["”]?(?=,|\s+at\b|\s+with\b|\s+and\b|[.;]|$)/i.exec(prompt)?.[1]?.trim();
    if(name)part.name=name;
    const position=/\bposition\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/i.exec(prompt);
    if(position)part.position=position.slice(1).map(Number) as [number,number,number];
    const diameter=new RegExp(`${number}\\s*(cm|centimetres?|centimeters?|m|metres?|meters?)\\s+(?:in\\s+)?diameter\\b`,"i").exec(prompt);
    if(diameter&&part.shape==="sphere"){const size=amount(diameter[1])*(/^c/i.test(diameter[2])?.01:1);part.size=[size,size,size];}
  }else if(edit.action==="rename"){
    const name=/\brename\b.+?\s+to\s+["“]?(.+?)["”]?(?=\s+(?:and|then)\s+(?:save|move|make|rotate|rename|duplicate|remove)\b|[.;]|$)/i.exec(prompt)?.[1]?.trim();
    if(name)result.name=name;
  }else if(edit.action==="move"){
    const distance=new RegExp(`${number}\\s*(cm|centimetres?|centimeters?|m|metres?|meters?)\\b[^.;,]{0,45}?\\b(right|left|up|down|forward|forwards|backward|backwards)\\b`,"i").exec(prompt);
    const reversed=new RegExp(`\\b(right|left|up|down|forward|forwards|backward|backwards)\\b[^.;,]{0,20}?${number}\\s*(cm|centimetres?|centimeters?|m|metres?|meters?)\\b`,"i").exec(prompt);
    const quantity=distance?.[1]??reversed?.[2],unit=distance?.[2]??reversed?.[3],direction=distance?.[3]??reversed?.[1];
    if(quantity&&unit&&direction){
      const length=amount(quantity)*(/^c/i.test(unit)?.01:1),axis=/right|left/i.test(direction)?0:/up|down/i.test(direction)?1:2;
      result.value=[0,0,0];result.value[axis]=length*(/left|down|back/i.test(direction)?-1:1);
    }
  }else if(edit.action==="rotate"){
    const angle=new RegExp(`${number}\\s*(?:degrees?|°)\\s*(?:(?:around|about|on)\\s+(?:the\\s+)?)?([xyz])\\b`,"i").exec(prompt);
    if(angle){result.value=[0,0,0];result.value['xyz'.indexOf(angle[2].toLowerCase())]=amount(angle[1]);}
  }else if(edit.action==="scale"){
    const ratio=/\b(twice|double|half|halve|triple)\b[^.;,]{0,25}?\b(wide|width|tall|height|deep|depth)\b/i.exec(prompt);
    const percentage=/\b(\d+(?:\.\d+)?)\s*%\s*(wider|narrower|taller|shorter|deeper)\b/i.exec(prompt);
    if(ratio||percentage){
      const dimension=ratio?.[2]??percentage![2],axis=/wid|narrow/i.test(dimension)?0:/tall|height|short/i.test(dimension)?1:2;
      const multiplier=ratio?(/half|halve/i.test(ratio[1])?.5:/triple/i.test(ratio[1])?3:2):1+Number(percentage![1])/100*(/narrower|shorter/i.test(dimension)?-1:1);
      result.value=[1,1,1];result.value[axis]=multiplier;
    }
  }
  return result;
}
