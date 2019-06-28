import {
  InitializeParams,
  InitializeRequest,
  InitializeResult,
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
  Logger,
  DidOpenTextDocumentNotification,
  Diagnostic,
  DocumentFormattingRequest,
  TextDocument
} from 'vscode-languageserver-protocol';
import { createConnection } from 'vscode-languageserver';
import { Duplex } from 'stream';
import { VLS } from './services/vls';
import { params } from './initParams';
import * as fs from 'fs';
import Uri from 'vscode-uri';
import * as glob from 'glob';
import * as path from 'path';

class NullLogger implements Logger {
  error(_message: string): void {}
  warn(_message: string): void {}
  info(_message: string): void {}
  log(_message: string): void {}
}

class TestStream extends Duplex {
  _write(chunk: string, _encoding: string, done: () => void) {
    this.emit('data', chunk);
    done();
  }

  _read(_size: number) {}
}

const workspacePath = process.cwd();
const workspaceUri = Uri.file(workspacePath).toString();

async function prepareClientConnection() {
  const up = new TestStream();
  const down = new TestStream();
  const logger = new NullLogger();

  const clientConnection = createProtocolConnection(new StreamMessageReader(down), new StreamMessageWriter(up), logger);

  const serverConnection = createConnection(new StreamMessageReader(up), new StreamMessageWriter(down));
  const vls = new VLS(serverConnection);

  serverConnection.onInitialize(
    async (params: InitializeParams): Promise<InitializeResult> => {
      await vls.init(params);

      console.log('Vetur initialized');

      return {
        capabilities: vls.capabilities
      };
    }
  );

  vls.listen();
  clientConnection.listen();

  const init: InitializeParams = {
    rootPath: workspacePath,
    rootUri: workspaceUri,
    ...params
  } as InitializeParams;

  await clientConnection.sendRequest(InitializeRequest.type, init);

  return clientConnection;
}

async function getDiagnostics() {
  const clientConnection = await prepareClientConnection();

  const files = glob.sync('**/*.vue', { cwd: workspacePath });
  const absFilePaths = files.map(f => path.resolve(workspacePath, f));

  console.log('');
  for (const absFilePath of absFilePaths) {
    console.log('');

    await clientConnection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        languageId: 'vue',
        uri: Uri.file(absFilePath).toString(),
        version: 1,
        text: fs.readFileSync(absFilePath, 'utf-8')
      }
    });

    try {
      const res = (await clientConnection.sendRequest('$/getDiagnostics', {
        uri: Uri.file(absFilePath).toString()
      })) as Diagnostic[];
      console.log(`File: ${absFilePath}`);
      res.forEach(d => {
        console.log(`Diag: ${d.message}`);
      });
    } catch (err) {
      console.log(err);
    }
    console.log('');
  }
}

async function getFormattingOutput(print: boolean) {
  const clientConnection = await prepareClientConnection();

  const files = glob.sync('**/*.vue', { cwd: workspacePath });
  const absFilePaths = files.map(f => path.resolve(workspacePath, f));

  console.log('');
  for (const absFilePath of absFilePaths) {
    console.log('');

    const vueFileText = fs.readFileSync(absFilePath, 'utf-8');
    const vueFileUri = Uri.file(absFilePath).toString();

    await clientConnection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        languageId: 'vue',
        uri: vueFileUri,
        version: 1,
        text: vueFileText
      }
    });

    const res = await clientConnection.sendRequest(DocumentFormattingRequest.type, {
      textDocument: {
        uri: Uri.file(absFilePath).toString()
      }
    });
    const doc = TextDocument.create(vueFileUri, 'vue', 1, vueFileText);

    const formattedText = res ? TextDocument.applyEdits(doc, res) : vueFileText;

    if (print) {
      fs.writeFileSync(absFilePath, formattedText);
      console.log(`File: ${absFilePath} rewritten`);
    } else {
      console.log(`File: ${absFilePath}`);
      console.log(formattedText);
    }
    console.log('');
  }
}

const myArgs = process.argv.slice(2);
// vls diag
if (myArgs[0] === 'diag') {
  console.log('Getting Vetur diagnostics');
  console.log('====================================');
  getDiagnostics().then(() => {
    console.log('====================================');
  });
} else if (myArgs[0] === 'format') {
  console.log('Getting Vetur diagnostics');
  console.log('====================================');
  const print = myArgs[1] === '-w' || myArgs[1] === '--write';
  getFormattingOutput(print).then(() => {
    console.log('====================================');
  });
}
