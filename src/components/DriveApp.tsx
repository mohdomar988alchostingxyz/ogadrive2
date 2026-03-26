import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  File,
  Download,
  Trash2,
  ExternalLink,
  Loader2,
  Plus,
  HardDrive,
  AlertCircle,
  CheckCircle2,
  Folder,
  FolderPlus,
  ChevronRight,
  ChevronLeft,
  ArrowUpDown,
  Edit2,
  Move,
  Link as LinkIcon,
  Copy,
  Info,
  Calendar,
  MoreVertical,
  Search,
  Image,
  Video,
  FileText,
  Archive,
  Check,
  Star,
  HelpCircle,
  Eye,
  EyeOff,
  FileJson,
  FileUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { driveApi, getDownloadUrl } from '@/lib/driveApi';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  fileCount?: number;
  folderCount?: number;
}

type SortField = 'name' | 'size' | 'modifiedTime' | 'createdTime';
type SortOrder = 'asc' | 'desc';

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState(() => sessionStorage.getItem('isUnlocked') === 'true');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [drives, setDrives] = useState<any[]>([]);
  const [activeDrive, setActiveDrive] = useState<any>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [editingDrive, setEditingDrive] = useState<any>(null);
  const [showSecrets, setShowSecrets] = useState(false);

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [isBulkRenaming, setIsBulkRenaming] = useState(false);
  const [bulkRenameBase, setBulkRenameBase] = useState('');
  const [isConfigured, setIsConfigured] = useState(true);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState('');
  const [folderHistory, setFolderHistory] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortField>('modifiedTime');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [dateType, setDateType] = useState<'createdTime' | 'modifiedTime'>('modifiedTime');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFileInfo, setSelectedFileInfo] = useState<DriveFile | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [storageQuota, setStorageQuota] = useState<{ limit: string; usage: string } | null>(null);
  const [modal, setModal] = useState<{
    type: 'rename' | 'delete' | 'move' | 'createFolder' | null;
    file?: DriveFile;
    inputValue?: string;
    targetFolderId?: string;
  }>({ type: null });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ROOT_FOLDER_ID = diagnostics?.folderId || '';

  useEffect(() => {
    const handleClickOutside = () => {
      setActiveMenuId(null);
      setSelectedFileInfo(null);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const checkConfig = async () => {
    try {
      const res = await driveApi('config-status', { method: 'POST' });
      const data = await res.json();
      setIsConfigured(data.isConfigured);
      setDiagnostics(data.diagnostics);
      setActiveDrive(data.activeDrive);
      if (data.diagnostics?.folderId && !currentFolderId) {
        setCurrentFolderId(data.diagnostics.folderId);
      }
      fetchStorageQuota();
    } catch (err) {
      console.error('Failed to check config status');
    }
  };

  const fetchDrives = async () => {
    try {
      const res = await driveApi('list-drives', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        // Map DB format to frontend format
        const mapped = data.map((d: any) => ({
          id: d.id,
          name: d.name,
          clientId: d.client_id,
          clientSecret: d.client_secret,
          refreshToken: d.refresh_token,
          redirectUri: d.redirect_uri,
          folderId: d.folder_id,
          isActive: d.is_active,
        }));
        setDrives(mapped);
      }
    } catch (err) {
      console.error('Failed to fetch drives');
    }
  };

  const fetchFiles = async (folderId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await driveApi('list-files', { method: 'POST', params: { folderId: folderId || '' } });
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to fetch files');
      }
    } catch (err) {
      setError('Failed to fetch files');
    } finally {
      setLoading(false);
    }
  };

  const fetchStorageQuota = async () => {
    try {
      const res = await driveApi('storage-quota', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setStorageQuota(data);
      }
    } catch (err) {
      console.error('Failed to fetch storage quota');
    }
  };

  const exportDrives = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(drives, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "drives_config.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const importDrives = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedDrives = JSON.parse(event.target?.result as string);
        if (Array.isArray(importedDrives)) {
          const res = await driveApi('import-drives', { body: importedDrives });
          if (res.ok) {
            setSuccess('Drives imported successfully');
            fetchDrives();
            checkConfig();
          } else {
            const data = await res.json();
            setError(data.error || 'Failed to import drives');
          }
        }
      } catch (err) {
        setError('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      const res = await driveApi('login', { body: { pin } });
      if (res.ok) {
        setIsUnlocked(true);
        sessionStorage.setItem('isUnlocked', 'true');
        setPinError(false);
      } else {
        setPinError(true);
        setPin('');
      }
    } catch (err) {
      setPinError(true);
    }
  };

  // Keyboard support for PIN entry
  useEffect(() => {
    if (isUnlocked) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        setPin(prev => prev.length < 5 ? prev + e.key : prev);
      } else if (e.key === 'Backspace') {
        setPin(prev => prev.slice(0, -1));
      } else if (e.key === 'Enter' && pin.length === 5) {
        handleLogin();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isUnlocked, pin]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (showSettings && drives.length === 0 && !editingDrive) {
      setEditingDrive({ name: '', clientId: '', clientSecret: '', refreshToken: '', redirectUri: 'https://developers.google.com/oauthplayground', folderId: '' });
    }
  }, [showSettings, drives.length]);

  const selectDrive = async (id: string) => {
    setError(null);
    setSuccess(null);
    try {
      const res = await driveApi('select-drive', { body: { id } });
      if (res.ok) {
        checkConfig();
        fetchDrives();
        setCurrentFolderId('');
        setFolderHistory([]);
      }
    } catch (err) {
      console.error('Failed to select drive');
    }
  };

  const saveDrive = async (driveData: any) => {
    setLoading(true);
    setError(null);
    try {
      const testRes = await driveApi('test-drive', { body: driveData });
      const testData = await testRes.json();
      if (!testRes.ok) {
        setError(`Configuration test failed: ${testData.error || 'Unknown error'}`);
        setLoading(false);
        return;
      }

      const res = await driveApi('save-drive', { body: driveData });
      if (res.ok) {
        setSuccess('Drive configuration saved and verified!');
        fetchDrives();
        checkConfig();
        setEditingDrive(null);
      }
    } catch (err: any) {
      setError(`Failed to save drive: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteDrive = async (id: string) => {
    if (!confirm('Are you sure you want to delete this drive configuration?')) return;
    try {
      const res = await driveApi('delete-drive', { body: { id } });
      if (res.ok) {
        fetchDrives();
        checkConfig();
      }
    } catch (err) {
      console.error('Failed to delete drive');
    }
  };

  useEffect(() => {
    if (isUnlocked) {
      checkConfig();
      fetchDrives();
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (currentFolderId) {
      fetchFiles(currentFolderId);
    }
  }, [currentFolderId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let filesToUpload: FileList | null = null;
    if ('dataTransfer' in e) {
      filesToUpload = e.dataTransfer.files;
    } else if ('target' in e) {
      filesToUpload = (e.target as HTMLInputElement).files;
    }

    const file = filesToUpload?.[0];
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    setUploadSpeed(0);
    setError(null);
    setSuccess(null);

    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
    const totalSize = file.size;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

    try {
      // Step 1: Initialize resumable upload session
      const initRes = await driveApi('init-upload', {
        body: { fileName: file.name, mimeType: file.type || 'application/octet-stream', parentId: currentFolderId },
      });
      const initData = await initRes.json();
      if (!initRes.ok || !initData.success) {
        throw new Error(initData.error || 'Failed to init upload');
      }

      const sessionUri = initData.sessionUri;
      let uploadedChunks = 0;
      const startTime = Date.now();
      let lastUpdate = Date.now();
      let lastUploaded = 0;

      // Step 2: Upload chunks one by one
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalSize);
        const chunk = file.slice(start, end);
        const isLastChunk = i === totalChunks - 1;

        const contentRange = `bytes ${start}-${end - 1}/${totalSize}`;

        // Upload chunk via edge function
        const chunkRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive-api?action=upload-chunk&sessionUri=${encodeURIComponent(sessionUri)}&contentRange=${encodeURIComponent(contentRange)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: chunk,
          }
        );

        const chunkData = await chunkRes.json();

        if (!chunkRes.ok && !chunkData.success) {
          throw new Error(chunkData.error || `Failed to upload chunk ${i + 1}`);
        }

        uploadedChunks++;
        const pct = Math.round((uploadedChunks / totalChunks) * 100);
        setUploadProgress(pct);

        // Calculate speed
        const now = Date.now();
        if (now - lastUpdate >= 500) {
          const elapsed = (now - startTime) / 1000;
          const bytesUploaded = uploadedChunks * CHUNK_SIZE;
          setUploadSpeed(bytesUploaded / elapsed);
          lastUpdate = now;
          lastUploaded = bytesUploaded;
        }

        // Check if upload completed
        if (chunkData.isComplete || (isLastChunk && chunkData.status === 200)) {
          // Step 3: Finalize - set permissions to make file public
          await driveApi('finalize-upload', { body: { fileId: chunkData.fileId } });
          break;
        }
      }

      setSuccess(`Uploaded ${file.name} successfully!`);
      fetchFiles(currentFolderId);
      fetchStorageQuota();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(100);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const createFolder = async (name: string) => {
    try {
      const res = await driveApi('create-folder', { body: { name, parentId: currentFolderId } });
      if (res.ok) {
        setSuccess('Folder created');
        fetchFiles(currentFolderId);
        setModal({ type: null });
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create folder');
      }
    } catch (err) {
      setError('Failed to create folder');
    }
  };

  const handleRename = async (fileId: string, newName: string) => {
    try {
      const res = await driveApi('rename-file', { body: { fileId, name: newName } });
      if (res.ok) {
        setSuccess('Renamed successfully');
        fetchFiles(currentFolderId);
        setModal({ type: null });
      } else {
        const data = await res.json();
        setError(data.error || 'Rename failed');
      }
    } catch (err) {
      setError('Rename failed');
    }
  };

  const handleMove = async (fileId: string, targetFolderId: string) => {
    try {
      const res = await driveApi('move-file', { body: { fileId, newParentId: targetFolderId } });
      if (res.ok) {
        setSuccess('Moved successfully');
        fetchFiles(currentFolderId);
        setModal({ type: null });
      } else {
        const data = await res.json();
        setError(data.error || 'Move failed');
      }
    } catch (err) {
      setError('Move failed');
    }
  };

  const navigateToFolder = (folderId: string) => {
    setSelectedFileInfo(null);
    setFolderHistory([...folderHistory, currentFolderId]);
    setCurrentFolderId(folderId);
  };

  const navigateBack = () => {
    setSelectedFileInfo(null);
    const newHistory = [...folderHistory];
    const prevFolderId = newHistory.pop();
    if (prevFolderId) {
      setFolderHistory(newHistory);
      setCurrentFolderId(prevFolderId);
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const sortedFiles = [...files]
    .filter(file =>
      file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      file.mimeType.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      const aIsFolder = a.mimeType === 'application/vnd.google-apps.folder';
      const bIsFolder = b.mimeType === 'application/vnd.google-apps.folder';
      if (aIsFolder && !bIsFolder) return -1;
      if (!aIsFolder && bIsFolder) return 1;

      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'size') {
        comparison = (parseInt(a.size || '0')) - (parseInt(b.size || '0'));
      } else if (sortBy === 'modifiedTime') {
        comparison = new Date(a.modifiedTime || 0).getTime() - new Date(b.modifiedTime || 0).getTime();
      } else if (sortBy === 'createdTime') {
        comparison = new Date(a.createdTime || 0).getTime() - new Date(b.createdTime || 0).getTime();
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const formatSize = (bytes?: string | number, mimeType?: string) => {
    if (!bytes || bytes === '0' || bytes === 0) {
      if (mimeType === 'application/vnd.google-apps.folder') return '0 B';
      return 'Unknown size';
    }
    const b = typeof bytes === 'number' ? bytes : parseInt(bytes);
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  const formatDate = (dateStr?: string, includeTime: boolean = true) => {
    if (!dateStr) return 'Unknown';
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    };
    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    return new Date(dateStr).toLocaleDateString('en-US', options);
  };

  const copyDownloadLink = (fileId: string, mimeType: string) => {
    if (mimeType === 'application/vnd.google-apps.folder') {
      setError('Cannot download folders directly');
      return;
    }
    const url = getDownloadUrl('download-file', { fileId });
    navigator.clipboard.writeText(url).then(() => {
      setSuccess('Direct download link copied to clipboard!');
      setTimeout(() => setSuccess(null), 3000);
    }).catch(() => {
      setError('Failed to copy link');
    });
  };

  const handleDelete = async (fileId: string) => {
    try {
      const res = await driveApi('delete-file', { body: { fileId } });
      if (res.ok) {
        setFiles(files.filter(f => f.id !== fileId));
        setSuccess('Deleted successfully');
        setModal({ type: null });
        fetchStorageQuota();
      } else {
        const data = await res.json();
        setError(data.error || 'Delete failed');
      }
    } catch (err) {
      setError('Delete failed');
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType === 'application/vnd.google-apps.folder') return <Folder size={18} />;
    if (mimeType.startsWith('image/')) return <Image size={18} />;
    if (mimeType.startsWith('video/')) return <Video size={18} />;
    if (mimeType.startsWith('text/') || mimeType === 'application/pdf' || mimeType.includes('document')) return <FileText size={18} />;
    if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('tar')) return <Archive size={18} />;
    return <File size={18} />;
  };

  const getIconColorClass = (mimeType: string) => {
    if (mimeType === 'application/vnd.google-apps.folder') return 'bg-yellow-50 text-yellow-600 group-hover:bg-yellow-100';
    if (mimeType.startsWith('image/')) return 'bg-purple-50 text-purple-600 group-hover:bg-purple-100';
    if (mimeType.startsWith('video/')) return 'bg-red-50 text-red-600 group-hover:bg-red-100';
    if (mimeType.startsWith('text/') || mimeType === 'application/pdf' || mimeType.includes('document')) return 'bg-blue-50 text-blue-600 group-hover:bg-blue-100';
    if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('tar')) return 'bg-orange-50 text-orange-600 group-hover:bg-orange-100';
    return 'bg-gray-50 text-gray-600 group-hover:bg-gray-100';
  };

  const toggleFileSelection = (fileId: string) => {
    const newSelection = new Set(selectedFileIds);
    if (newSelection.has(fileId)) {
      newSelection.delete(fileId);
    } else {
      newSelection.add(fileId);
    }
    setSelectedFileIds(newSelection);
  };

  const selectAllFiles = () => {
    if (selectedFileIds.size === files.length && files.length > 0) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(files.map(f => f.id)));
    }
  };

  const handleBulkDownload = async () => {
    if (selectedFileIds.size === 0) return;

    const selectedFiles = files.filter(f => selectedFileIds.has(f.id));
    const namePart = selectedFiles.map(f => f.name.split('.')[0]).join('+');
    const filename = `${namePart}.zip`;

    setLoading(true);
    try {
      const response = await driveApi('download-bulk', {
        body: { fileIds: Array.from(selectedFileIds), filename }
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        setSelectedFileIds(new Set());
      } else {
        setError('Bulk download failed');
      }
    } catch (error) {
      setError('Error downloading files');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkRename = async () => {
    if (selectedFileIds.size === 0 || !bulkRenameBase) return;

    setLoading(true);
    try {
      const response = await driveApi('rename-bulk', {
        body: { fileIds: Array.from(selectedFileIds), baseName: bulkRenameBase }
      });

      if (response.ok) {
        setSuccess('Files renamed successfully');
        setIsBulkRenaming(false);
        setBulkRenameBase('');
        setSelectedFileIds(new Set());
        fetchFiles(currentFolderId);
      } else {
        const data = await response.json();
        setError(data.error || 'Bulk rename failed');
      }
    } catch (error) {
      setError('Error renaming files');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkMove = async (targetFolderId: string) => {
    if (selectedFileIds.size === 0) return;

    setLoading(true);
    try {
      const response = await driveApi('move-bulk', {
        body: { fileIds: Array.from(selectedFileIds), targetFolderId }
      });

      if (response.ok) {
        setSuccess('Files moved successfully');
        setSelectedFileIds(new Set());
        setModal({ type: null });
        fetchFiles(currentFolderId);
      } else {
        const data = await response.json();
        setError(data.error || 'Bulk move failed');
      }
    } catch (error) {
      setError('Error moving files');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadFile = async (fileId: string) => {
    try {
      const res = await driveApi('download-file', { method: 'POST', params: { fileId } });
      if (res.ok) {
        const disposition = res.headers.get('content-disposition');
        let filename = 'download';
        if (disposition) {
          const match = disposition.match(/filename="(.+?)"/);
          if (match) filename = match[1];
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      } else {
        setError('Download failed');
      }
    } catch {
      setError('Download failed');
    }
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter PIN</h2>
          <p className="text-gray-500 text-sm mb-6">5-digit PIN required</p>

          <div className="flex justify-center gap-3 mb-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold transition-all ${pin[i] ? 'border-[#26BAA4] bg-[#F0FBF9]' : pin.length === i ? 'border-[#26BAA4] shadow-lg' : 'border-gray-200'}`}>
                {pin[i] ? '•' : pin.length === i ? '|' : ''}
              </div>
            ))}
          </div>

          {pinError && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-500 text-sm mb-4 flex items-center justify-center gap-1">
              <AlertCircle size={14} /> Incorrect PIN, please try again.
            </motion.p>
          )}

          <div className="grid grid-cols-3 gap-2 mb-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button key={num} onClick={() => pin.length < 5 && setPin(pin + num)} className="h-14 bg-gray-50 hover:bg-gray-100 rounded-xl text-xl font-semibold transition-colors">
                {num}
              </button>
            ))}
            <div></div>
            <button onClick={() => pin.length < 5 && setPin(pin + '0')} className="h-14 bg-gray-50 hover:bg-gray-100 rounded-xl text-xl font-semibold transition-colors">0</button>
            <button onClick={() => setPin(pin.slice(0, -1))} className="h-14 bg-gray-50 hover:bg-gray-100 rounded-xl flex items-center justify-center transition-colors">
              <ChevronLeft size={24} />
            </button>
          </div>
          <button onClick={() => handleLogin()} disabled={pin.length !== 5} className="w-full py-4 bg-[#8ED8CD] hover:bg-[#7BC9BD] text-white rounded-xl font-bold transition-colors disabled:opacity-50">
            Unlock
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div
        className="relative"
        onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; if (dragCounter.current === 1) setIsDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDragLeave={(e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setIsDragging(false); }}
        onDrop={(e) => { e.preventDefault(); dragCounter.current = 0; setIsDragging(false); handleUpload(e); }}
      >
        {isDragging && (
          <div className="fixed inset-0 bg-blue-500/10 border-4 border-dashed border-blue-400 z-50 flex items-center justify-center">
            <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
              <Upload size={48} className="mx-auto mb-4 text-blue-500" />
              <p className="text-xl font-bold text-gray-900">Drop files to upload</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-4">
          <div className="flex items-center justify-between max-w-7xl mx-auto">
            <div className="flex items-center gap-3">
              <HardDrive className="text-[#26BAA4]" size={28} />
              <div>
                <h1 className="text-xl font-bold text-gray-900">OGA File Drive</h1>
                {activeDrive && <p className="text-xs text-gray-500">{activeDrive.name}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#26BAA4] w-48 md:w-64"
                />
              </div>
              <button onClick={() => setModal({ type: 'createFolder', inputValue: '' })} className="p-2 hover:bg-gray-100 rounded-xl text-gray-600 transition-colors" title="Create Folder">
                <FolderPlus size={20} />
              </button>
              <label className="p-2 hover:bg-gray-100 rounded-xl text-gray-600 transition-colors cursor-pointer" title="Upload File">
                <Upload size={20} />
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
              </label>
              <button onClick={() => { setShowSettings(!showSettings); }} className="p-2 hover:bg-gray-100 rounded-xl text-gray-600 transition-colors" title="Settings">
                <HardDrive size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bg-white border-b border-gray-200 px-4 md:px-8 py-6">
              <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">Drive Settings</h3>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowHelp(!showHelp)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors text-sm font-medium ${showHelp ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-400'}`} title="Show Help">
                      <HelpCircle size={16} /> Help
                    </button>
                    <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
                  </div>
                </div>

                {showHelp && (
                  <div className="bg-blue-50 rounded-2xl p-5 mb-4 text-sm text-gray-700">
                    <h4 className="font-bold text-blue-800 mb-2">How to get your Google Drive Secrets</h4>
                    <p className="mb-2"><strong>1. Client ID & Secret</strong></p>
                    <ul className="list-disc pl-5 mb-3 space-y-1">
                      <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="text-blue-600 underline">Google Cloud Console</a> and create a project.</li>
                      <li>Enable <strong>Google Drive API</strong> in "APIs & Services".</li>
                      <li>Configure <strong>OAuth Consent Screen</strong> (External).</li>
                      <li>In <strong>Credentials</strong>, create an <strong>OAuth client ID</strong> (Web application).</li>
                      <li>Add <code className="bg-white px-1 rounded">https://developers.google.com/oauthplayground</code> to <strong>Authorized redirect URIs</strong>.</li>
                    </ul>
                    <p className="mb-2"><strong>2. Refresh Token</strong></p>
                    <ul className="list-disc pl-5 mb-3 space-y-1">
                      <li>Go to <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer" className="text-blue-600 underline">OAuth 2.0 Playground</a>.</li>
                      <li>Click the <strong>Gear icon</strong> (Settings), check "Use your own OAuth credentials", and enter your ID/Secret.</li>
                      <li>Select <strong>Drive API v3</strong> (<code className="bg-white px-1 rounded">.../auth/drive</code>) and click <strong>Authorize APIs</strong>.</li>
                      <li>Click <strong>Exchange authorization code for tokens</strong> and copy the <strong>Refresh token</strong>.</li>
                    </ul>
                    <p className="mb-2"><strong>3. Folder ID</strong></p>
                    <p>Open your Google Drive folder. The ID is the string of characters at the end of the URL (after <code className="bg-white px-1 rounded">folders/</code>).</p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                  {drives.map((d: any) => (
                    <div key={d.id} className={`rounded-2xl border-2 p-4 transition-all ${d.isActive ? 'border-[#26BAA4] bg-[#F0FBF9]' : 'border-gray-200 hover:border-gray-300'}`}>
                      <button className="w-full text-left" onClick={() => selectDrive(d.id)}>
                        <div className="flex items-center gap-2 mb-2">
                          {d.isActive ? (
                            <Star size={16} className="text-yellow-500 fill-yellow-500" />
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); selectDrive(d.id); }} className="text-gray-300 hover:text-yellow-400">
                              <Star size={16} />
                            </button>
                          )}
                          <span className="font-bold text-gray-900 truncate">{d.name}</span>
                        </div>
                      </button>
                      <div className="flex items-center gap-1 mt-2">
                        <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(JSON.stringify(d, null, 2)); setSuccess('Drive configuration copied to clipboard'); }} className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-gray-600 transition-colors" title="Copy Configuration">
                          <Copy size={14} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setEditingDrive(d); }} className="flex items-center gap-1 px-2 py-1 hover:bg-gray-200 rounded-lg text-gray-500 hover:text-blue-600 transition-colors text-xs font-bold uppercase" title="Edit Settings">
                          <Edit2 size={12} /> Edit
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); deleteDrive(d.id); }} className="p-1.5 hover:bg-red-100 text-red-400 hover:text-red-600 rounded-lg transition-colors" title="Delete Drive">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => setEditingDrive({ name: '', clientId: '', clientSecret: '', refreshToken: '', redirectUri: 'https://developers.google.com/oauthplayground', folderId: '' })} className="p-4 rounded-2xl border-2 border-dashed border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-blue-600">
                    <Plus size={24} />
                    <span className="text-sm font-medium">Add New Drive</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <button onClick={exportDrives} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium text-gray-700 transition-colors">
                    <FileJson size={16} /> Export Config
                  </button>
                  <label className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium text-gray-700 transition-colors cursor-pointer">
                    <FileUp size={16} /> Import Config
                    <input type="file" accept=".json" className="hidden" onChange={importDrives} />
                  </label>
                </div>

                {editingDrive && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-gray-50 rounded-2xl p-5 border border-gray-200">
                    <h4 className="font-bold text-gray-900 mb-4">{editingDrive.id ? 'Edit Drive' : 'New Drive Configuration'}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Drive Name</label>
                        <input value={editingDrive.name} onChange={(e) => setEditingDrive({ ...editingDrive, name: e.target.value })} className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#26BAA4]" placeholder="e.g. Work Drive" />
                      </div>
                      <div className="relative">
                        <label className="text-xs font-bold text-gray-500 uppercase">Client ID</label>
                        <input type={showSecrets ? 'text' : 'password'} value={editingDrive.clientId} onChange={(e) => setEditingDrive({ ...editingDrive, clientId: e.target.value })} className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#26BAA4] pr-10" />
                        <button onClick={() => setShowSecrets(!showSecrets)} className="absolute right-3 top-7 text-gray-400 hover:text-gray-600">
                          {showSecrets ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <div className="relative">
                        <label className="text-xs font-bold text-gray-500 uppercase">Client Secret</label>
                        <input type={showSecrets ? 'text' : 'password'} value={editingDrive.clientSecret} onChange={(e) => setEditingDrive({ ...editingDrive, clientSecret: e.target.value })} className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#26BAA4] pr-10" />
                        <button onClick={() => setShowSecrets(!showSecrets)} className="absolute right-3 top-7 text-gray-400 hover:text-gray-600">
                          {showSecrets ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <div className="relative">
                        <label className="text-xs font-bold text-gray-500 uppercase">Refresh Token</label>
                        <input type={showSecrets ? 'text' : 'password'} value={editingDrive.refreshToken} onChange={(e) => setEditingDrive({ ...editingDrive, refreshToken: e.target.value })} className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#26BAA4] pr-10" />
                        <button onClick={() => setShowSecrets(!showSecrets)} className="absolute right-3 top-7 text-gray-400 hover:text-gray-600">
                          {showSecrets ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Redirect URI</label>
                        <input value={editingDrive.redirectUri} onChange={(e) => setEditingDrive({ ...editingDrive, redirectUri: e.target.value })} className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#26BAA4]" />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Folder ID</label>
                        <input value={editingDrive.folderId} onChange={(e) => setEditingDrive({ ...editingDrive, folderId: e.target.value })} className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#26BAA4]" />
                      </div>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button onClick={() => setEditingDrive(null)} className="flex-1 py-2 border border-gray-200 rounded-xl font-bold hover:bg-gray-100 transition-colors">Cancel</button>
                      <button onClick={() => saveDrive(editingDrive)} className="flex-1 py-2 bg-[#26BAA4] text-white rounded-xl font-bold hover:bg-[#1E9E8A] transition-colors">Save Configuration</button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
          {/* Bulk Actions Toolbar */}
          <AnimatePresence>
            {selectedFileIds.size > 0 && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bg-white rounded-2xl shadow-lg border border-gray-200 p-3 mb-4 flex items-center gap-2 flex-wrap">
                <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-bold">{selectedFileIds.size}</span>
                <span className="text-sm text-gray-500">Selected</span>
                <button onClick={handleBulkDownload} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-lg text-sm font-medium text-gray-700 transition-colors">
                  <Download size={16} /> Download
                </button>
                <button onClick={() => setIsBulkRenaming(true)} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-lg text-sm font-medium text-gray-700 transition-colors" title="Rename selected">
                  <Edit2 size={16} /> Rename
                </button>
                <button onClick={() => setModal({ type: 'move' })} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-lg text-sm font-medium text-gray-700 transition-colors" title="Move selected">
                  <Move size={16} /> Move
                </button>
                <button onClick={() => setSelectedFileIds(new Set())} className="flex items-center gap-2 px-3 py-2 hover:bg-red-50 text-red-600 rounded-lg text-sm font-medium transition-colors">
                  Cancel
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bulk Rename Modal */}
          <AnimatePresence>
            {isBulkRenaming && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                  <h3 className="text-lg font-bold text-gray-900 mb-2">Bulk Rename</h3>
                  <p className="text-sm text-gray-500 mb-4">Enter a base name. Files will be renamed to "{bulkRenameBase} 1", "{bulkRenameBase} 2", etc.</p>
                  <input value={bulkRenameBase} onChange={(e) => setBulkRenameBase(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all mb-6" autoFocus />
                  <div className="flex gap-3">
                    <button onClick={() => setIsBulkRenaming(false)} className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 rounded-xl font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
                    <button onClick={handleBulkRename} disabled={!bulkRenameBase || loading} className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50">
                      {loading ? 'Renaming...' : 'Rename All'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation Breadcrumbs */}
          <div className="flex items-center gap-2 mb-4 text-sm text-gray-600">
            <button onClick={() => { setFolderHistory([]); setCurrentFolderId(ROOT_FOLDER_ID); }} className="hover:text-blue-600 font-medium">
              My Drive
            </button>
            {folderHistory.length > 0 && (
              <>
                <ChevronRight size={14} />
                <button onClick={navigateBack} className="hover:text-blue-600 font-medium flex items-center gap-1">
                  <ChevronLeft size={14} /> Back
                </button>
              </>
            )}
          </div>

          {/* Status Messages */}
          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm">
                <AlertCircle size={16} />
                {error}
              </motion.div>
            )}
            {success && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm">
                <CheckCircle2 size={16} />
                {success}
              </motion.div>
            )}
          </AnimatePresence>

          {uploading && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Uploading file...</span>
                <span className="text-sm text-gray-500">{uploadProgress.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-[#26BAA4] h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            </div>
          )}

          {/* Files Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-[auto_1fr_100px_140px_120px] gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase items-center">
              <button onClick={selectAllFiles} className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${selectedFileIds.size > 0 ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 hover:border-blue-400'}`}>
                {selectedFileIds.size === files.length && files.length > 0 && <Check size={12} />}
              </button>
              <button className="flex items-center gap-1 hover:text-gray-700" onClick={() => toggleSort('name')}>
                Name {sortBy === 'name' && <ArrowUpDown size={12} />}
              </button>
              <button className="flex items-center gap-1 hover:text-gray-700" onClick={() => toggleSort('size')}>
                Size {sortBy === 'size' && <ArrowUpDown size={12} />}
              </button>
              <div className="flex flex-col items-start">
                <button className="flex items-center gap-1 hover:text-gray-700" onClick={() => toggleSort(dateType)}>
                  Date {(sortBy === 'createdTime' || sortBy === 'modifiedTime') && <ArrowUpDown size={12} />}
                </button>
                <div className="flex gap-1 mt-1 bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => { setDateType('createdTime'); setSortBy('createdTime'); }} className={`px-2 py-0.5 rounded-md text-[9px] transition-all ${dateType === 'createdTime' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Created</button>
                  <button onClick={() => { setDateType('modifiedTime'); setSortBy('modifiedTime'); }} className={`px-2 py-0.5 rounded-md text-[9px] transition-all ${dateType === 'modifiedTime' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Modified</button>
                </div>
              </div>
              <span>Actions</span>
            </div>

            {/* File Rows */}
            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="animate-spin mr-2" size={20} />
                Accessing your drive...
              </div>
            ) : sortedFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Folder size={48} className="mb-4 text-gray-300" />
                <p className="font-medium">No files found in this folder</p>
                <p className="text-sm mt-1">Upload something to get started</p>
              </div>
            ) : (
              sortedFiles.map((file) => (
                <div key={file.id} className="group grid grid-cols-[auto_1fr_100px_140px_120px] gap-4 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 items-center text-sm transition-colors relative">
                  <button onClick={(e) => { e.stopPropagation(); toggleFileSelection(file.id); }} className={`w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${selectedFileIds.has(file.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 hover:border-blue-400 opacity-0 group-hover:opacity-100'}`}>
                    {selectedFileIds.has(file.id) && <Check size={12} />}
                  </button>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${getIconColorClass(file.mimeType)}`}>
                      {getFileIcon(file.mimeType)}
                    </div>
                    <div className="min-w-0 flex items-center gap-2">
                      {file.mimeType === 'application/vnd.google-apps.folder' ? (
                        <button onClick={() => navigateToFolder(file.id)} className="font-medium truncate text-sm hover:text-blue-600 text-left">
                          {file.name}
                        </button>
                      ) : (
                        <span className="font-medium truncate text-sm text-gray-900">{file.name}</span>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setSelectedFileInfo(selectedFileInfo?.id === file.id ? null : file); }} className={`p-1 rounded-full transition-all ${selectedFileInfo?.id === file.id ? 'bg-blue-100 text-blue-600 opacity-100' : 'hover:bg-gray-200 text-gray-300 hover:text-blue-600 opacity-40 group-hover:opacity-100'}`}>
                        <Info size={14} />
                      </button>

                      {/* Info Popup */}
                      {selectedFileInfo?.id === file.id && (
                        <div onClick={(e) => e.stopPropagation()} className="absolute left-0 top-full mt-2 z-50 bg-white border border-gray-200 shadow-2xl rounded-2xl p-5 w-80 text-sm">
                          <div className="flex items-start gap-3 mb-4">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${getIconColorClass(file.mimeType)}`}>
                              {getFileIcon(file.mimeType)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="font-bold text-gray-900 truncate">{file.name}</h4>
                            </div>
                            <button onClick={() => setSelectedFileInfo(null)} className="text-gray-400 hover:text-gray-600 p-1 flex-shrink-0 ml-2">×</button>
                          </div>
                          <div className="space-y-2 text-gray-600">
                            <div className="flex justify-between"><span className="text-gray-400">Type</span><span>{file.mimeType.split('.').pop()?.split('/').pop()}</span></div>
                            <div className="flex justify-between"><span className="text-gray-400">Size</span><span>{formatSize(file.size, file.mimeType)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-400">Uploaded</span><span>{formatDate(file.createdTime)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-400">Modified</span><span>{formatDate(file.modifiedTime)}</span></div>
                            {file.mimeType === 'application/vnd.google-apps.folder' && (
                              <>
                                <div className="border-t border-gray-100 pt-2 mt-2">
                                  <div className="flex justify-between"><span className="text-gray-400">Folders</span><span>{file.folderCount || 0}</span></div>
                                  <div className="flex justify-between"><span className="text-gray-400">Files</span><span>{file.fileCount || 0}</span></div>
                                </div>
                              </>
                            )}
                          </div>
                          <div className="flex gap-2 mt-4">
                            {file.webViewLink && (
                              <a href={file.webViewLink} target="_blank" rel="noreferrer" className="flex-1 text-center py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors flex items-center justify-center gap-1">
                                <ExternalLink size={12} /> Drive
                              </a>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); handleDownloadFile(file.id); }} className="flex-1 text-center py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-1">
                              <Download size={12} /> {file.mimeType === 'application/vnd.google-apps.folder' ? 'Download ZIP' : 'Download'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-gray-500 text-xs">{formatSize(file.size, file.mimeType)}</span>
                  <span className="text-gray-500 text-xs">{formatDate(dateType === 'createdTime' ? file.createdTime : file.modifiedTime, false)}</span>
                  <div className="flex items-center gap-0.5">
                    <button onClick={(e) => { e.stopPropagation(); copyDownloadLink(file.id, file.mimeType); }} className="p-2 hover:bg-blue-100 hover:text-blue-600 rounded-full transition-colors text-gray-400" title="Copy Direct Download Link">
                      <LinkIcon size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDownloadFile(file.id); }} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400" title={file.mimeType === 'application/vnd.google-apps.folder' ? "Download ZIP" : "Download"}>
                      <Download size={14} />
                    </button>
                    <div className="relative">
                      <button onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === file.id ? null : file.id); }} className={`p-2 rounded-full transition-colors ${activeMenuId === file.id ? 'bg-gray-200 text-gray-900' : 'hover:bg-gray-200 text-gray-400 hover:text-gray-900'}`} title="More actions">
                        <MoreVertical size={14} />
                      </button>
                      {activeMenuId === file.id && (
                        <div onClick={(e) => e.stopPropagation()} className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-40 py-1 w-44">
                          <button onClick={() => { setModal({ type: 'rename', file, inputValue: file.name }); setActiveMenuId(null); }} className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                            <Edit2 size={14} /> Rename
                          </button>
                          <button onClick={() => { setModal({ type: 'move', file }); setActiveMenuId(null); }} className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                            <Move size={14} /> Move
                          </button>
                          {file.webViewLink && (
                            <a href={file.webViewLink} target="_blank" rel="noreferrer" className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                              <ExternalLink size={14} /> View in Drive
                            </a>
                          )}
                          <div className="border-t border-gray-100 my-1"></div>
                          <button onClick={() => { setModal({ type: 'delete', file }); setActiveMenuId(null); }} className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Setup Instructions */}
          {!isConfigured && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mt-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Configuration Required</h2>
              {diagnostics?.lastError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700">
                  <strong>Auth Error:</strong> {diagnostics.lastError}
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <h3 className="font-bold text-gray-700 mb-2">1. Required Secrets</h3>
                  <p className="text-sm text-gray-500 mb-2">Go to <strong>Settings</strong> and configure your drive credentials:</p>
                  <ul className="space-y-1 text-sm">
                    <li className="flex items-center gap-2">{diagnostics?.hasClientId ? <CheckCircle2 size={14} className="text-green-500" /> : <AlertCircle size={14} className="text-red-500" />} <code className="bg-gray-100 px-2 py-0.5 rounded">Client ID</code></li>
                    <li className="flex items-center gap-2">{diagnostics?.hasClientSecret ? <CheckCircle2 size={14} className="text-green-500" /> : <AlertCircle size={14} className="text-red-500" />} <code className="bg-gray-100 px-2 py-0.5 rounded">Client Secret</code></li>
                    <li className="flex items-center gap-2">{diagnostics?.hasRefreshToken ? <CheckCircle2 size={14} className="text-green-500" /> : <AlertCircle size={14} className="text-red-500" />} <code className="bg-gray-100 px-2 py-0.5 rounded">Refresh Token</code></li>
                    <li className="flex items-center gap-2">{diagnostics?.folderId ? <CheckCircle2 size={14} className="text-green-500" /> : <AlertCircle size={14} className="text-red-500" />} <code className="bg-gray-100 px-2 py-0.5 rounded">Folder ID</code></li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-bold text-gray-700 mb-2">2. How to get them</h3>
                  <ol className="list-decimal pl-5 text-sm text-gray-600 space-y-1">
                    <li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="text-blue-600 underline">Google Cloud Console</a>.</li>
                    <li>Create an <strong>OAuth 2.0 Client ID</strong> (Web Application).</li>
                    <li>Add <code className="bg-gray-100 px-1 rounded">https://developers.google.com/oauthplayground</code> as an <strong>Authorized Redirect URI</strong>.</li>
                    <li>Use the <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer" className="text-blue-600 underline">OAuth Playground</a> to generate a <strong>Refresh Token</strong>.</li>
                    <li>Ensure you use your own Client ID/Secret in the Playground settings (⚙️).</li>
                  </ol>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Custom Modal */}
        <AnimatePresence>
          {modal.type && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div onClick={() => setModal({ type: null })} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md z-10">
                <h3 className="text-lg font-bold text-gray-900 mb-2">
                  {modal.type === 'rename' && 'Rename Item'}
                  {modal.type === 'delete' && 'Delete Item'}
                  {modal.type === 'move' && 'Move Item'}
                  {modal.type === 'createFolder' && 'Create New Folder'}
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  {modal.type === 'rename' && `Enter a new name for "${modal.file?.name}"`}
                  {modal.type === 'delete' && `Are you sure you want to delete "${modal.file?.name}"? This action cannot be undone.`}
                  {modal.type === 'move' && `Select a destination for "${modal.file?.name || 'selected files'}"`}
                  {modal.type === 'createFolder' && 'Enter a name for the new folder'}
                </p>

                {(modal.type === 'rename' || modal.type === 'createFolder') && (
                  <input
                    value={modal.inputValue || ''}
                    onChange={(e) => setModal({ ...modal, inputValue: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all mb-6"
                    placeholder="Enter name..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (modal.type === 'rename' && modal.file) handleRename(modal.file.id, modal.inputValue!);
                        if (modal.type === 'createFolder') createFolder(modal.inputValue!);
                      }
                    }}
                  />
                )}

                {modal.type === 'move' && (
                  <div className="max-h-64 overflow-y-auto mb-4">
                    {folderHistory.length > 0 && (
                      <button onClick={() => {
                        if (selectedFileIds.size > 0) {
                          handleBulkMove(folderHistory[folderHistory.length - 1]);
                        } else if (modal.file) {
                          handleMove(modal.file.id, folderHistory[folderHistory.length - 1]);
                        }
                      }} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-blue-50 text-blue-600 transition-colors text-left font-medium">
                        <ChevronLeft size={16} /> Move up to parent folder
                      </button>
                    )}
                    {files.filter(f => f.mimeType === 'application/vnd.google-apps.folder' && f.id !== modal.file?.id && !selectedFileIds.has(f.id)).map(folder => (
                      <button key={folder.id} onClick={() => {
                        if (selectedFileIds.size > 0) {
                          handleBulkMove(folder.id);
                        } else if (modal.file) {
                          handleMove(modal.file.id, folder.id);
                        }
                      }} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 text-gray-700 transition-colors text-left">
                        <Folder size={16} className="text-yellow-500" /> {folder.name}
                      </button>
                    ))}
                    {files.filter(f => f.mimeType === 'application/vnd.google-apps.folder' && f.id !== modal.file?.id && !selectedFileIds.has(f.id)).length === 0 && folderHistory.length === 0 && (
                      <div className="text-center py-8 text-gray-400">
                        <Folder size={32} className="mx-auto mb-2 text-gray-300" />
                        <p className="text-sm">No folders available to move to</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button onClick={() => setModal({ type: null })} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                  {modal.type !== 'move' && (
                    <button onClick={() => {
                      if (modal.type === 'rename' && modal.file) handleRename(modal.file.id, modal.inputValue!);
                      if (modal.type === 'delete' && modal.file) handleDelete(modal.file.id);
                      if (modal.type === 'createFolder') createFolder(modal.inputValue!);
                    }} className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${modal.type === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                      {modal.type === 'delete' ? 'Delete' : 'Confirm'}
                    </button>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
