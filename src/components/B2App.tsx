import React, { useState, useEffect, useRef } from 'react';
import {
  Upload, File, Download, Trash2, Loader2, RefreshCw,
  FileText, Image, Video, Archive, FileJson, Music,
  Search, AlertCircle, CheckCircle2, HardDrive, FolderUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { b2Api, getB2DownloadUrl, getB2UploadUrl } from '@/lib/b2Api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';

interface B2File {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(key: string) {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
  const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'];
  const dataExts = ['json', 'xml', 'csv', 'yaml', 'yml'];

  if (imageExts.includes(ext)) return <Image className="h-5 w-5 text-emerald-500" />;
  if (videoExts.includes(ext)) return <Video className="h-5 w-5 text-purple-500" />;
  if (audioExts.includes(ext)) return <Music className="h-5 w-5 text-pink-500" />;
  if (archiveExts.includes(ext)) return <Archive className="h-5 w-5 text-amber-500" />;
  if (docExts.includes(ext)) return <FileText className="h-5 w-5 text-blue-500" />;
  if (dataExts.includes(ext)) return <FileJson className="h-5 w-5 text-orange-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

interface UploadProgress {
  fileName: string;
  progress: number;
  done: boolean;
}

const B2App: React.FC = () => {
  const [files, setFiles] = useState<B2File[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [prefix, setPrefix] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await b2Api('list', { method: 'GET', params: prefix ? { prefix } : {} });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to list files');
      setFiles(data.files || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFiles(); }, [prefix]);

  const uploadFileWithProgress = (file: globalThis.File, key: string, index: number): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        // Get presigned URL from edge function
        const presignRes = await b2Api('presign-upload', {
          body: { key, contentType: file.type || 'application/octet-stream' },
        });
        const presignData = await presignRes.json();
        if (!presignData.success) {
          reject(new Error(presignData.error || 'Failed to get presigned URL'));
          return;
        }

        // Upload directly to B2 using presigned headers
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(prev => prev.map((p, i) => i === index ? { ...p, progress: pct } : p));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadProgress(prev => prev.map((p, i) => i === index ? { ...p, progress: 100, done: true } : p));
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error(`Network error uploading ${file.name}`)));
        xhr.open('PUT', presignData.url);

        // Set the signed headers
        for (const [k, v] of Object.entries(presignData.headers)) {
          xhr.setRequestHeader(k, v as string);
        }

        xhr.send(file);
      } catch (err: any) {
        reject(err);
      }
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError('');
    setSuccess('');

    const fileArr = Array.from(fileList);
    setUploadProgress(fileArr.map(f => ({ fileName: f.name, progress: 0, done: false })));

    try {
      for (let i = 0; i < fileArr.length; i++) {
        await uploadFileWithProgress(fileArr[i], prefix + fileArr[i].name, i);
      }
      setSuccess(`Uploaded ${fileArr.length} file(s) successfully`);
      setTimeout(() => { setSuccess(''); setUploadProgress([]); }, 3000);
      fetchFiles();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`Delete "${key}"?`)) return;
    try {
      const res = await b2Api('delete', { body: { key } });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Delete failed');
      setSuccess(`Deleted "${key}"`);
      setTimeout(() => setSuccess(''), 3000);
      fetchFiles();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDownload = (key: string) => {
    window.open(getB2DownloadUrl(key), '_blank');
  };

  const filtered = files.filter(f =>
    f.key.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HardDrive className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">Backblaze B2 Files</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchFiles} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Messages */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive flex items-center gap-2"
            >
              <AlertCircle className="h-4 w-4" />
              {error}
              <button className="ml-auto text-sm underline" onClick={() => setError('')}>Dismiss</button>
            </motion.div>
          )}
          {success && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-4 p-3 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              {success}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Upload progress */}
        <AnimatePresence>
          {uploadProgress.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-4 space-y-2 p-4 rounded-lg border border-border bg-card"
            >
              <p className="text-sm font-medium mb-2">Uploading files...</p>
              {uploadProgress.map((up, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm truncate max-w-[200px]">{up.fileName}</span>
                  <Progress value={up.progress} className="flex-1 h-2" />
                  <span className="text-xs text-muted-foreground w-10 text-right">
                    {up.done ? <CheckCircle2 className="h-4 w-4 text-emerald-500 inline" /> : `${up.progress}%`}
                  </span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Prefix / Search bar */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Input
            placeholder="Prefix filter (e.g. uploads/)"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            className="w-64"
          />
        </div>

        {/* File list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <FolderUp className="h-12 w-12 mb-3" />
            <p className="text-lg font-medium">No files found</p>
            <p className="text-sm">Upload files to get started</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground text-sm">
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium w-28">Size</th>
                  <th className="text-left px-4 py-3 font-medium w-44">Modified</th>
                  <th className="text-right px-4 py-3 font-medium w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((file) => (
                  <motion.tr
                    key={file.key}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-t border-border hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {getFileIcon(file.key)}
                        <span className="text-sm truncate max-w-md" title={file.key}>
                          {file.key}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {formatSize(file.size)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(file.lastModified).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownload(file.key)}
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(file.key)}
                          title="Delete"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-sm text-muted-foreground">
          {filtered.length} file(s) • Total: {formatSize(filtered.reduce((acc, f) => acc + f.size, 0))}
        </div>
      </div>
    </div>
  );
};

export default B2App;
