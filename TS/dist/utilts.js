import { readdirSync, statSync } from "fs";
import * as path from "path";
export function mapToObj(map) {
    const obj = {};
    map.forEach((value, key) => {
        obj[key] = value;
    });
    return obj;
}
export function prettyPrintMap(map) {
    let str = ``;
    map.forEach((value, key) => {
        str += ` > ${key}: ${JSON.stringify(value).slice(0, 350)}\n`;
    });
    return str;
}
export function prettyPrintArray(arr) {
    let str = ``;
    arr.forEach((value, index) => {
        str += ` > ${index}: ${JSON.stringify(value).slice(0, 350)}\n`;
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
export const json = (thing) => JSON.stringify(thing, null, 3);
//# sourceMappingURL=utilts.js.map