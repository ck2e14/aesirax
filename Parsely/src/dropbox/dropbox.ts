import { unlinkSync, watch, } from "fs"
import { mkdir } from "fs/promises"
import { write } from "../logging/logQ.js"
import { findDICOM } from "../utils.js"
import { singleTheaded } from "../parsing/orchestration/singlethreaded.js"

export async function monitorDropbox(cfg: Global.Cfg, dropboxPath = '/Users/chriskennedy/Desktop/aesiraxDropbox') {
  mkdir(dropboxPath + '/' + 'outputs', { recursive: true })

  // TODO implement support for dropping directories of files in here. Should work out of the box pretty easy given that 
  // multi/singlethread functions use findDICOM() which recurses through all depths - but pretty sure we need to fix how the 
  // writeFileSync is working because its assuming its only dealing with one path at the moment which is obviously wrong. 

  watch(dropboxPath, async (eventType, filename) => {
    if (eventType === 'rename') {
      if (!filename.endsWith('.dcm')) {
        return // just supporting single files atm
      }

      const files = findDICOM(dropboxPath)
      if (files.length > 1) {
        write(`Currently not supporting bulk drops into the dropbox - do one file at a time.`, "ERROR")
        return
      }
      if (files.length === 0) {
        return // have to do this because delete events trigger the same event 
      }

      write('New DICOM file in dropbox... file... ' + filename, "DEBUG")
      await singleTheaded({ ...cfg, targetDir: dropboxPath }, dropboxPath + '/' + 'outputs')

      return
      try {
        unlinkSync(dropboxPath + '/' + filename)
      } catch (error) {
        // is ok just swallow. It's recursively called itself because rename event gets called for removal as well lol. Stupid API tbh. 
      }
    }
  })
}
