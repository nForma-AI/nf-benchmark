'use strict';

const fs = require('fs');
const path = require('path');

function applyJsonMutation(filePath, mutation, projectRoot) {
  const fullPath = path.join(projectRoot, filePath);
  
  // Check for path length limits (approximate, OS-dependent)
  if (fullPath.length > 1000) {
    throw new Error(`File path too long: ${fullPath.length} characters`);
  }

  let data;

  try {
    data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENAMETOOLONG') {
      throw new Error(`File path too long for filesystem: ${fullPath}`);
    }
    if (mutation.type === 'file-create') {
      data = {};
    } else {
      throw new Error(`Cannot read ${fullPath}: ${e.message}`);
    }
  }

  const jsonPath = mutation.json_path;
  if (!jsonPath) return data;

  const segments = parseJsonPath(jsonPath);

  switch (mutation.type) {
    case 'json-field-modify':
      if (segments.length === 0) return mutation.value; // root replacement (json_path: "$")
      setJsonPath(data, segments, mutation.value);
      break;
    case 'json-field-delete':
      deleteJsonPath(data, segments);
      break;
    case 'json-field-add':
      if (jsonPath.endsWith(']') || mutation.value instanceof Array) {
        ensureArrayAt(data, segments);
        pushToArray(data, segments, mutation.value);
      } else {
        setJsonPath(data, segments, mutation.value);
      }
      break;
    case 'json-entry-add':
      const entrySegments = segments.slice(); // copy
      if (entrySegments.length > 0 && entrySegments[entrySegments.length - 1].type === 'index') {
        entrySegments.pop(); // remove the index segment
      }
      ensureArrayAt(data, entrySegments);
      const arr = getArrayAt(data, entrySegments);
      arr.push(mutation.value);
      break;
    case 'json-entry-remove':
      removeArrayEntry(data, segments);
      break;
    default:
      break;
  }

  return data;
}

function parseJsonPath(jsonPath) {
  const segments = [];
  let current = '';
  let inBracket = false;
  let bracketContent = '';
  let i = 0;

  // Skip the $ root indicator
  if (jsonPath.startsWith('$')) {
    i = 1;
  }

  for (; i < jsonPath.length; i++) {
    const ch = jsonPath[i];
    if (ch === '.' && !inBracket) {
      if (current) segments.push({ type: 'key', value: current });
      current = '';
    } else if (ch === '[') {
      if (current) segments.push({ type: 'key', value: current });
      current = '';
      inBracket = true;
    } else if (ch === ']') {
      if (bracketContent) {
        const num = parseInt(bracketContent, 10);
        if (isNaN(num)) {
          segments.push({ type: 'key', value: bracketContent.replace(/"/g, '') });
        } else {
          segments.push({ type: 'index', value: num });
        }
      }
      inBracket = false;
      bracketContent = '';
    } else if (inBracket) {
      bracketContent += ch;
    } else {
      current += ch;
    }
  }
  if (current) segments.push({ type: 'key', value: current });

  return segments;
}

function navigateToParent(data, segments) {
  let obj = data;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg.type === 'key') {
      if (obj[seg.value] === undefined) obj[seg.value] = {};
      obj = obj[seg.value];
    } else {
      // For index segments, ensure the array exists and has enough elements
      if (!Array.isArray(obj)) obj = [];
      while (obj.length <= seg.value) obj.push({});
      obj = obj[seg.value];
    }
  }
  return obj;
}

function setJsonPath(data, segments, value) {
  const parent = navigateToParent(data, segments);
  const last = segments[segments.length - 1];
  if (last.type === 'key') {
    parent[last.value] = value;
  } else {
    parent[last.value] = value;
  }
}

function deleteJsonPath(data, segments) {
  const parent = navigateToParent(data, segments);
  const last = segments[segments.length - 1];
  if (last.type === 'key') {
    delete parent[last.value];
  } else {
    parent.splice(last.value, 1);
  }
}

function ensureArrayAt(data, segments) {
  const parent = navigateToParent(data, segments);
  const last = segments[segments.length - 1];
  if (last.type === 'key') {
    if (!Array.isArray(parent[last.value])) {
      parent[last.value] = [];
    }
  }
}

function getArrayAt(data, segments) {
  const parent = navigateToParent(data, segments);
  const last = segments[segments.length - 1];
  if (last.type === 'key') return parent[last.value];
  return parent[last.value];
}

function pushToArray(data, segments, value) {
  const arr = getArrayAt(data, segments);
  if (Array.isArray(value)) {
    arr.push(...value);
  } else {
    arr.push(value);
  }
}

function removeArrayEntry(data, segments) {
  const parent = navigateToParent(data, segments);
  const last = segments[segments.length - 1];
  if (last.type === 'index') {
    parent.splice(last.value, 1);
  }
}

function applyFileMutation(filePath, mutation, projectRoot) {
  const fullPath = path.join(projectRoot, filePath);

  switch (mutation.type) {
    case 'file-create':
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(fullPath)) {
        fs.writeFileSync(fullPath, mutation.content || '');
      }
      break;
    case 'file-delete':
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      break;
    case 'file-modify':
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const appendText = mutation.append !== undefined ? mutation.append : '\n// modified by benchmark';
        fs.writeFileSync(fullPath, content + appendText);
      }
      break;
    case 'file-rename':
      if (fs.existsSync(fullPath)) {
        const newPath = path.join(projectRoot, mutation.new_name || 'renamed.file');
        fs.renameSync(fullPath, newPath);
      }
      break;
    default:
      break;
  }
}

function applyConfigChange(filePath, mutation, projectRoot) {
  return applyJsonMutation(filePath, mutation, projectRoot);
}

function applyMutation(challenge, projectRoot) {
  const mutation = challenge.mutation;
  if (!mutation || !mutation.target_file) {
    throw new Error('Invalid mutation: missing target_file');
  }

  // null-mutation: explicitly do nothing (used for no_regression challenges)
  if (mutation.type === 'null-mutation') {
    return { mutated_file: mutation.target_file, mutation_type: 'null-mutation' };
  }

  const filePath = mutation.target_file;
  const fullPath = path.join(projectRoot, filePath);

  const isJson = filePath.endsWith('.json');
  const isFileOp = ['file-create', 'file-delete', 'file-rename'].includes(mutation.type);

  if (isFileOp) {
    applyFileMutation(filePath, mutation, projectRoot);
  } else if (isJson || mutation.type === 'config-change') {
    const data = applyJsonMutation(filePath, mutation, projectRoot);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + '\n');
  } else {
    applyFileMutation(filePath, mutation, projectRoot);
  }

  return { mutated_file: filePath, mutation_type: mutation.type };
}

module.exports = {
  applyMutation,
  applyJsonMutation,
  applyFileMutation,
  parseJsonPath
};
