import fs from 'fs'
import path from 'path'
import * as uuid from 'uuid'
import commander from 'commander'
import ProgressBar from 'progress'
import axios, { AxiosResponse } from 'axios'
import { Stream } from 'stream'

type ImageData = {
  src: string
  filename?: string
  err?: string
}

type Data = {
  referer: string
  images: ImageData[]
}

const REG = {
  image: /!\[[^\]]*\]\(([^)]+)\)/g,
}

const getHEADERS = (referer: string) => ({
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36',
  Connection: 'keep-alive',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  Referer: referer,
})

commander
  .command('download <markdownFile> <destDir> <referer>')
  .alias('d')
  .description('Download the images in the <markdownFile> to <destDir>')
  .action((markdownFile: string, destDir: string, referer: string) =>
    download(markdownFile, destDir, referer)
  )
commander
  .command('replace <markdownFile> <destDir> <newMarkdownFile>')
  .alias('r')
  .description(
    'Replace the images in the <markdownFile> from <destDir> to <newMarkdownFile>'
  )
  .action((markdownFile, destDir, newMarkdownFile) =>
    replace(markdownFile, destDir, newMarkdownFile)
  )

const error = (title: string, message: string) =>
  console.error(`${title}:\n${message}`)

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), ms))

const getContent = (path: string) => {
  try {
    return fs.readFileSync(path, { encoding: 'utf-8' })
  } catch (err) {
    error('getContent:', err)
    throw err
  }
}

const getDataFilepath = (destDir: string) => path.join(destDir, 'data.json')

const imageToDataURI = (buffer: Buffer) =>
  `data:image/png;base64,${buffer.toString('base64')}`

const checkDestDir = (destDir: string) => {
  if (!fs.existsSync(destDir)) {
    try {
      fs.mkdirSync(destDir)
      console.info(`${destDir} created!`)
    } catch (err) {
      error(destDir, err)
      throw err
    }
  }
}

const getFileType = (buffer: Buffer) => {
  const FILEKEY = [
    {
      begin: [0xff, 0xd8],
      end: [0xff, 0xd9],
      ext: '.jpg',
      mime: 'image/jpeg',
    },
    {
      begin: [0x00, 0x00, 0x02, 0x00, 0x00],
      ext: '.tga',
      mime: '',
    },
    {
      begin: [0x00, 0x00, 0x10, 0x00, 0x00],
      ext: '.rle',
      mime: '',
    },
    {
      begin: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ext: '.png',
      mime: 'image/png',
    },
    {
      begin: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
      ext: '.gif',
      mime: 'image/gif',
    },
    {
      begin: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
      ext: '.gif',
      mime: 'image/gif',
    },
    {
      begin: [0x42, 0x4d],
      ext: '.bmp',
      mime: 'image/bmp',
    },
    {
      begin: [0x0a],
      ext: '.pcx',
      mime: '',
    },
    {
      begin: [0x49, 0x49],
      ext: '.tif',
      mime: 'image/pcx',
    },
    {
      begin: [0x4d, 0x4d],
      ext: '.tif',
      mime: 'image/tiff',
    },
    {
      begin: [0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x20, 0x20],
      ext: '.ico',
      mime: 'image/x-icon',
    },
    {
      begin: [0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x20, 0x20],
      ext: '.cur',
      mime: '',
    },
    {
      begin: [0x46, 0x4f, 0x52, 0x4d],
      ext: '.iff',
      mime: '',
    },
    {
      begin: [0x52, 0x49, 0x46, 0x46],
      ext: '.ani',
      mime: '',
    },
  ]

  const token = FILEKEY.find(({ begin, end, ext, mime }) => {
    let found = false
    if (begin) {
      found = Buffer.from(begin).equals(buffer.slice(0, begin.length))
    }
    if (end) {
      found &&= Buffer.from(end).equals(buffer.slice(-end.length))
    }
    return found
  })

  return token
}

const download = async (
  markdownFile: string,
  destDir: string,
  referer: string
) => {
  try {
    checkDestDir(destDir)
  } catch {
    return
  }

  let content: string
  try {
    content = getContent(markdownFile)
  } catch {
    return
  }

  const srcs = Array.from(content.matchAll(REG.image)).map(
    (marr) => Array.from(marr)[1]
  )

  const bar = new ProgressBar('downloading [:bar] :current/:total', {
    total: srcs.length,
  })

  const images: ImageData[] = await Promise.all(
    srcs.map(async (src, index, arr) => {
      bar.tick()

      try {
        const res: AxiosResponse<Stream> = await axios.get(src, {
          responseType: 'stream',
          headers: getHEADERS(referer),
        })
        const imageFileName = uuid.v4()
        res.data.pipe(fs.createWriteStream(path.join(destDir, imageFileName)))
        return {
          src,
          filename: imageFileName,
        }
      } catch (err) {
        error(src, err)
        return {
          src,
          err,
        }
      }
    })
  )

  const dataFile = getDataFilepath(destDir)
  try {
    fs.writeFileSync(
      dataFile,
      JSON.stringify(
        {
          referer,
          images,
        },
        null,
        2
      ),
      {
        encoding: 'utf-8',
      }
    )
  } catch (err) {
    error(dataFile, err)
  }
}

const replace = async (
  markdownFile: string,
  destDir: string,
  newMarkdownFile: string
) => {
  const dataFile = getDataFilepath(destDir)
  let images: ImageData[] = []
  try {
    const data: Data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'))
    images = data?.images ?? []
  } catch (err) {
    error(dataFile, err)
    return
  }

  let content: string
  try {
    content = getContent(markdownFile)
  } catch {
    return
  }

  const bar = new ProgressBar('replacing [:bar] :current/:total :message', {
    total: images.length,
  })

  for (let { src, filename, err } of images) {
    bar.tick({
      message: filename || err,
    })

    if (!filename) return

    const imageFile = path.join(destDir, filename)
    const fileType = getFileType(fs.readFileSync(imageFile))

    if (!fileType) return

    await sleep(500)
    bar.tick(0, { message: `${filename} - ${fileType.ext}` })

    content = content.replace(src, `${imageFile}`)
  }

  fs.writeFileSync(newMarkdownFile, content, { encoding: 'utf-8' })
}

commander.parse(process.argv)
