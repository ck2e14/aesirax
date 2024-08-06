export function prettyPrintMap(map) {
    let str = ``;
    map.forEach((value, key) => {
        str += ` > ${key}: ${JSON.stringify(value).slice(0, 150)}\n`;
    });
    return str;
}
//# sourceMappingURL=utilts.js.map