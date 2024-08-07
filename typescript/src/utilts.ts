import { readdirSync, statSync } from "fs";
import path from "path";

export function prettyPrintMap(map: Map<string, any>): string {
   let str = ``;

   map.forEach((value, key) => {
      str += ` > ${key}: ${JSON.stringify(value).slice(0, 150)}\n`;
   });

   return str;
}

export function prettyPrintArray(arr: any[]): string {
   let str = ``;

   arr.forEach((value, index) => {
      str += ` > ${index}: ${JSON.stringify(value).slice(0, 150)}\n`;
   });

   return str;
}

export function findDICOM(folder = "./", fileList = []) {
   readdirSync(folder).forEach(file => {
      const filePath = path.join(folder, file);

      if (statSync(filePath).isDirectory()) {
         findDICOM(filePath, fileList);
      }

      if (file.endsWith(".dcm")) {
         fileList.push(filePath);
      }
   });
   return fileList;
}
