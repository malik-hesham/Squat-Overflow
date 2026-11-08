import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Controller, Get, Header, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { exerciseCatalog, type CatalogEntry } from './catalog';
import { VERSION } from './config';

const PRIVACY_PAGE = join(__dirname, '..', 'static', 'privacy.html');
const YOUTUBE_ID = /^[\w-]{11}$/;

@Controller()
export class AppController {
  private readonly privacyHtml = readFileSync(PRIVACY_PAGE, 'utf8');

  @Get('health')
  health(): { ok: true; version: string; exercises: CatalogEntry[] } {
    return { ok: true, version: VERSION, exercises: exerciseCatalog() };
  }

  /** Public privacy policy; the Chrome Web Store listing links here. */
  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacy(): string {
    return this.privacyHtml;
  }

  @Get('embed/:youtubeId')
  embed(@Param('youtubeId') youtubeId: string, @Res({ passthrough: true }) res: Response): string {
    if (!YOUTUBE_ID.test(youtubeId)) throw new NotFoundException();
    res.type('html'); // only on success, so a 404 keeps its JSON body type
    const src =
      `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=1&loop=1` +
      `&playlist=${youtubeId}&controls=0&modestbranding=1&playsinline=1&rel=0`;
    return (
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{display:block;border:0;width:100%;height:100%}</style>' +
      `</head><body><iframe src="${src}" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`
    );
  }
}
