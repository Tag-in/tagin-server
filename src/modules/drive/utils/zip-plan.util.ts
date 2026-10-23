import { resolveUniqueName } from './unique-name.util.js';

export interface ZipFolder {
  id: string;
  parentId: string | null;
  name: string;
}

export interface ZipFile {
  id: string;
  /** 속한 폴더. 선택한 폴더 트리 밖이면 ZIP 최상위에 둔다. */
  folderId: string;
  name: string;
  storageKey: string;
}

export interface ZipEntry {
  /** ZIP 안의 경로. 폴더는 끝에 '/'가 붙는다. */
  path: string;
  /** 파일이면 스토리지 키, 폴더(디렉터리 항목)면 null */
  storageKey: string | null;
}

/** ZIP 경로 조각으로 쓸 수 없는 문자를 바꾼다 (경로 구분자, 제어문자, '.'/'..'). */
const safeSegment = (name: string): string => {
  const cleaned = [...name]
    .map((c) => (c === '/' || c === '\\' || c.charCodeAt(0) < 32 ? '_' : c))
    .join('')
    .trim();
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned;
};

/**
 * 선택한 폴더(roots)와 그 하위 트리, 파일 목록으로 ZIP 안의 경로를 정한다.
 * - 폴더 구조를 유지하고, 선택한 폴더가 ZIP 최상위 디렉터리가 된다. 빈 폴더도 디렉터리로 남긴다.
 * - 폴더 트리 밖의 파일(따로 선택한 파일)은 최상위에 둔다.
 * - 같은 디렉터리에서 이름이 겹치면(파일명은 유일하지 않다) "이름 (1).확장자"로 바꾼다.
 */
export const buildZipPlan = ({
  roots,
  folders,
  files,
}: {
  roots: ZipFolder[];
  folders: ZipFolder[];
  files: ZipFile[];
}): ZipEntry[] => {
  const childrenOf = new Map<string, ZipFolder[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    childrenOf.set(folder.parentId, [
      ...(childrenOf.get(folder.parentId) ?? []),
      folder,
    ]);
  }
  const folderIds = new Set(folders.map((f) => f.id));
  const filesIn = new Map<string, ZipFile[]>();
  const standalone: ZipFile[] = [];
  for (const file of files) {
    if (folderIds.has(file.folderId)) {
      filesIn.set(file.folderId, [...(filesIn.get(file.folderId) ?? []), file]);
    } else {
      standalone.push(file);
    }
  }

  const taken = new Map<string, Set<string>>();
  const place = (dir: string, name: string, isFile: boolean): string => {
    const names = taken.get(dir) ?? new Set<string>();
    taken.set(dir, names);
    const unique = resolveUniqueName(safeSegment(name), names, {
      keepExtension: isFile,
    });
    names.add(unique);
    return dir === '' ? unique : `${dir}/${unique}`;
  };

  const entries: ZipEntry[] = [];
  const walk = (folder: ZipFolder, dir: string): void => {
    const path = place(dir, folder.name, false);
    entries.push({ path: `${path}/`, storageKey: null });
    for (const child of childrenOf.get(folder.id) ?? []) walk(child, path);
    for (const file of filesIn.get(folder.id) ?? []) {
      entries.push({
        path: place(path, file.name, true),
        storageKey: file.storageKey,
      });
    }
  };

  for (const root of roots) walk(root, '');
  for (const file of standalone) {
    entries.push({
      path: place('', file.name, true),
      storageKey: file.storageKey,
    });
  }
  return entries;
};
