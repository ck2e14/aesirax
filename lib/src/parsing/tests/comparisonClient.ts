// this file should basically automate testing 
// efficacy and performance comparisons between 
// my lib, dctmtk, and anything else 

import cluster from "cluster"
import { Worker } from "worker_threads"

// i wanna be able to just give it a study uuid 
// and it gets the first image of each series 
// and downloads it and compares it. 

const studyUuid = '123'

export async function Client() {
  const results = { state: 'incomplete' }

  return {
    compare,
    results
  }
}

async function getFirstImageOfEachSeries() {
  // ...
}

// give each lib its own thread 
type Lib =
  | 'dcmtk'
  | 'aesirax'

async function compare(images: Buffer[], libs: Lib[]) {
  const threads = await spinUpThreads({ n: 2 })

  // 1. ask a thread to parse the file using your lib 
  // 2. ask a thread to parse the 
}

async function spinUpThreads(args: { n: number }) {
  const p: Promise<void>[] = []
  const workers: Worker[] = []

  for (let i = 0; i < args.n; i++) {
    const resolveWhenOnline = new Promise((res, rej) => {
      const worker = new Worker('./comparisonWorker.js')

      worker.on('error', (error) => console.log(error))

      worker.on('message', (msg: unknown) => {
        console.log(`PID[${cluster.settings.serialization}] received message: `)
        console.log(msg)
      })

      // worker.on('online', () => )
    })
  }

  const r = await Promise.all(p)
  console.log({ r })
}
