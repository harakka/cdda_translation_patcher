import { po } from "gettext-parser";
import { createWriteStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { exit } from "node:process";

if (!process.argv[2] || !process.argv[3] || !process.argv[4]) {
  console.log("usage: npm run start po_folder_to_merge_into path_to_translations_to_merge_from path_to_output_folder");
  exit(1);
}
const oldLangPath = process.argv[2];
const newLangPath = process.argv[3];
const outPath = process.argv[4];

const poFiles = (await readdir(oldLangPath, { recursive: true, withFileTypes: true }))
  .filter((file) => extname(file.name) === ".po")
  .map((file) => [file.name, join(oldLangPath, file.name), join(newLangPath, file.name)]);

poFiles.forEach(async ([lang_id, oldFile, newFile]) => {
  const logStream = createWriteStream(join(outPath, lang_id + "_log.txt"));
  const oldPoData = po.parse(await readFile(oldFile), "utf-8");
  const newPoData = po.parse(await readFile(newFile), "utf-8");
  const tContexts = Object.keys(oldPoData.translations);

  let totalKeys = 0;
  let totalChanges = 0;
  let missingCount = 0;

  tContexts.forEach((ctx) => {
    const tKeys = Object.keys(oldPoData.translations[ctx]);
    totalKeys = totalKeys + tKeys.length;
    tKeys.forEach((key) => {
      try {
        // Skip translation comment
        if (ctx === "" && key == "") {
          return;
        }

        let dirty = false;
        // This throws if key has been removed in later translation, exiting the loop
        const newT = newPoData.translations[ctx][key];
        const oldT = oldPoData.translations[ctx][key];

        // translation is nonplural, translation has changed, new translation is nonempty
        if (
          oldT.msgstr.length == 1 &&
          newT.msgstr.length == 1 &&
          oldT.msgstr[0] != newT.msgstr[0] &&
          newT.msgstr[0] != ""
        ) {
          logStream.write(
            `key: "${ctx ? ctx + "->" + key : key}"\n\told: "${oldT.msgstr[0]}"\n\tnew: "${newT.msgstr[0]}"\n`,
          );
          oldT.msgstr = newT.msgstr;
          dirty = true;
        }

        // translation is plural and has same count and new translation is nonempty
        else if (
          newT.msgstr.length > 1 &&
          oldT.msgstr.length == newT.msgstr.length &&
          oldT.msgstr.join("") != newT.msgstr.join("") &&
          newT.msgstr.join("") != ""
        ) {
          logStream.write(
            `key: "${ctx ? ctx + "->" + key : key}"\n\told plurals: ${oldT.msgstr.join("") != "" ? `"${oldT.msgstr.join('" / "')}"` : "empty"}\n\tnew plurals: "${newT.msgstr.join('" / "')}"\n`,
          );
          oldT.msgstr = newT.msgstr;
          dirty = true;
        }

        if (dirty) {
          totalChanges++;
        }
      } catch (e: unknown) {
        missingCount++;
      }
    });
  });

  logStream.end();
  if (totalChanges > 0) {
    console.log(
      `${lang_id} had total ${tContexts.length} contexts, ${totalKeys} keys, ${totalChanges} updates, ${missingCount} misses`,
    );
    writeFile(join(outPath, lang_id), po.compile(oldPoData, { foldLength: 78, sort: false, escapeCharacters: true }));
  } else {
    console.log(`${lang_id} had total ${tContexts.length} contexts, ${totalKeys} keys. No changes found.`);
  }
});
