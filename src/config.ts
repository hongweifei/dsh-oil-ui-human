import Schema from '@deepseek-ai/schemastery';

export interface Config {
  workspaceRoot?: string;
  previewPort: number;
  skillDir?: string;
  imageGenScript?: string;
}

export const Config: Schema<Config> = Schema.object({
  workspaceRoot: Schema.string().default(''),
  skillDir: Schema.string().default(''),
  imageGenScript: Schema.string().default(''),
  previewPort: Schema.number().min(0).max(65535).default(0),
});
