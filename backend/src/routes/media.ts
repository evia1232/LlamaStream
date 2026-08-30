import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

const router = Router();

router.get('/avatars/:filename', (req, res) => {
  const filePath = path.join(config.avatarPath, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

router.get('/covers/:filename', (req, res) => {
  const filePath = path.join(config.cachePath, 'covers', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

export default router;
