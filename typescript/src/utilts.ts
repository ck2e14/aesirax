export function prettyPrintMap(map: Map<string, any>): string {
   let str = ``;

   map.forEach((value, key) => {
      str += ` > ${key}: ${JSON.stringify(value).slice(0, 150)}\n`;
   });

   return str;
}
