import { unlinkSync, watch, } from "fs"
import { singleTheaded } from "../singlethreaded.js"
import { write } from "../logging/logQ.js"


export async function monitorDropbox(cfg: Global.Cfg, dropboxPath = '/Users/chriskennedy/Desktop/aesiraxDropbox') {

  watch(dropboxPath, async (eventType, filename) => {
    if (eventType === 'rename') {
      if (!filename.endsWith('.dcm')) {
        return 
      }
      write('New DICOM file in dropbox... file... ' + filename, "DEBUG")
      await singleTheaded({ ...cfg, targetDir: dropboxPath }, dropboxPath)
      try {
        unlinkSync(dropboxPath + '/' + filename)
      } catch (error) {
        // is ok just swallow. It's recursively called itself because rename event gets called for removal as well lol. Stupid API tbh. 
      }
    }
  })
}
