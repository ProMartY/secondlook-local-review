import { embedDescriptions, modelStatus } from './model.js';

try {
  const vectors = await embedDescriptions(['A synthetic invoice description used only to prepare the local model.']);
  console.log(JSON.stringify({ ...modelStatus(), testDimensions: vectors[0].length }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
