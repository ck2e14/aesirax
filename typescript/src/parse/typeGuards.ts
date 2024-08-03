import { VR } from "../globalEnums.js";

export const isVr = (vr: string): vr is Global.VR => {
   return vr in VR;
};
