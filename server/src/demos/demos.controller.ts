import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { demosDir } from '../config';

/** A demo video's file name: a catalog move's key and .mp4 (no dots, slashes or capitals). */
const VIDEO = /^[a-z0-9_]+\.mp4$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The exercise demo videos: GET /demos/<move>.mp4. Short, silent H.264 MP4s that
 * extension/scripts/make-demo-video.mjs makes into server/demos/ and checks. The clients ask for a
 * move's video only when the user opens its demo, and show the drawn figure when there is none.
 * Byte ranges, ETags and Last-Modified come from Express's sendFile; iPhones need the ranges.
 */
@Controller('demos')
export class DemosController {
  @Get(':file')
  video(@Param('file') file: string, @Res() res: Response): void {
    if (!VIDEO.test(file)) throw new NotFoundException();
    res.sendFile(
      file,
      {
        root: demosDir(),
        dotfiles: 'deny',
        maxAge: DAY_MS,
        headers: { 'Content-Type': 'video/mp4', 'X-Content-Type-Options': 'nosniff' },
      },
      (err) => {
        if (err && !res.headersSent) res.status(404).end();
      },
    );
  }
}
