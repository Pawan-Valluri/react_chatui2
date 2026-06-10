import { useEffect, useRef } from 'react';
import JSZip from 'jszip';

// Mapping from OOXML standard w:type to CSS pseudo-selectors
const TBL_STYLE_MAP: Record<string, string> = {
  firstRow: 'tr:first-child td, tr:first-child th',
  lastRow: 'tr:last-child td, tr:last-child th',
  firstCol: 'tr td:first-child, tr th:first-child',
  lastCol: 'tr td:last-child, tr th:last-child',
  band1Vert: 'tr td:nth-child(odd), tr th:nth-child(odd)',
  band2Vert: 'tr td:nth-child(even), tr th:nth-child(even)',
  band1Horz: 'tr:nth-child(odd) td, tr:nth-child(odd) th',
  band2Horz: 'tr:nth-child(even) td, tr:nth-child(even) th',
  nwCell: 'tr:first-child td:first-child, tr:first-child th:first-child',
  neCell: 'tr:first-child td:last-child, tr:first-child th:last-child',
  swCell: 'tr:last-child td:first-child, tr:last-child th:first-child',
  seCell: 'tr:last-child td:last-child, tr:last-child th:last-child',
};

// Colors mapping schema: a:clrScheme -> themeColor mappings
const THEME_MAPPINGS: Record<string, string> = {
  dk1: 'text1',
  lt1: 'background1',
  dk2: 'text2',
  lt2: 'background2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hyperlink',
  folHlink: 'followedHyperlink'
};

const resolveColor = (hexVal: string | null, themeColor: string | null, themeMap: Record<string, string>): string | null => {
  if (themeColor && themeMap[themeColor]) {
    return `#${themeMap[themeColor]}`;
  }
  if (hexVal && hexVal !== 'auto') {
    return `#${hexVal}`;
  }
  return null;
};

const parseBorder = (borderElement: Element, themeMap: Record<string, string>): string | null => {
  const val = borderElement.getAttribute('w:val');
  if (!val || val === 'none') return 'none';

  const color = resolveColor(
    borderElement.getAttribute('w:color'),
    borderElement.getAttribute('w:themeColor'),
    themeMap
  ) || '#000000';
  const szAttr = borderElement.getAttribute('w:sz');
  const size = szAttr ? Math.max(1, Math.floor(parseInt(szAttr) / 4)) : 1;

  let style = 'solid';
  if (val === 'dashed' || val === 'dotted' || val === 'double') style = val;

  return `${size}px ${style} ${color}`;
};

const STYLE_ELEMENT_ID = 'docx-dynamic-styles';

export const useDocxStyles = (documentBuffer?: ArrayBuffer | null) => {
  const lastBufferRef = useRef<ArrayBuffer | null>(null);

  useEffect(() => {
    console.log('[useDocxStyles] Hook called. Buffer exists:', !!documentBuffer, 'Buffer size:', documentBuffer?.byteLength);

    if (!documentBuffer) {
      console.log('[useDocxStyles] No documentBuffer, skipping.');
      return;
    }

    // Avoid re-parsing the exact same buffer
    if (lastBufferRef.current === documentBuffer) {
      console.log('[useDocxStyles] Same buffer reference, skipping re-parse.');
      return;
    }
    lastBufferRef.current = documentBuffer;

    let cancelled = false;

    const parseAndInject = async () => {
      try {
        console.log('[useDocxStyles] Starting JSZip parsing...');
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(documentBuffer);
        
        const fileNames = Object.keys(loadedZip.files);
        console.log('[useDocxStyles] ZIP contains', fileNames.length, 'files. Has theme:', fileNames.includes('word/theme/theme1.xml'), 'Has styles:', fileNames.includes('word/styles.xml'));

        // 1. Extract Theme Colors
        const themeMap: Record<string, string> = {};
        const themeFile = loadedZip.file('word/theme/theme1.xml');
        if (themeFile) {
          const themeXmlStr = await themeFile.async('string');
          const parser = new DOMParser();
          const themeDoc = parser.parseFromString(themeXmlStr, 'text/xml');

          const parseErr = themeDoc.getElementsByTagName('parsererror');
          if (parseErr.length > 0) {
            console.error('[useDocxStyles] Theme XML parse error:', parseErr[0].textContent);
          }

          const clrScheme = themeDoc.getElementsByTagName('a:clrScheme')[0];
          if (clrScheme) {
            Array.from(clrScheme.children).forEach(node => {
              const nodeName = node.tagName.split(':').pop();
              if (nodeName && THEME_MAPPINGS[nodeName]) {
                const srgbClr = node.getElementsByTagName('a:srgbClr')[0];
                const sysClr = node.getElementsByTagName('a:sysClr')[0];
                const hexVal = srgbClr?.getAttribute('val') || sysClr?.getAttribute('lastClr');
                if (hexVal) {
                  themeMap[THEME_MAPPINGS[nodeName]] = hexVal;
                }
              }
            });
          }
          console.log('[useDocxStyles] Theme colors resolved:', JSON.stringify(themeMap));
        } else {
          console.warn('[useDocxStyles] No theme file found in ZIP!');
        }

        // 2. Extract Table Styles
        const stylesFile = loadedZip.file('word/styles.xml');
        if (!stylesFile) {
          console.error('[useDocxStyles] No styles.xml found in ZIP!');
          return;
        }

        const stylesXmlStr = await stylesFile.async('string');
        const parser = new DOMParser();
        const stylesDoc = parser.parseFromString(stylesXmlStr, 'text/xml');

        const parseErr = stylesDoc.getElementsByTagName('parsererror');
        if (parseErr.length > 0) {
          console.error('[useDocxStyles] Styles XML parse error:', parseErr[0].textContent);
          return;
        }

        const cssRules: string[] = [];

        const allStyles = Array.from(stylesDoc.getElementsByTagName('w:style'));
        const tableStyles = allStyles.filter(s => s.getAttribute('w:type') === 'table');
        console.log('[useDocxStyles] Found', allStyles.length, 'total styles,', tableStyles.length, 'table styles');

        tableStyles.forEach(styleNode => {
          const sid = styleNode.getAttribute('w:styleId');
          if (!sid) return;

          const baseSelector = `.ProseMirror table[data-style-id="${sid}"]`;
          console.log('[useDocxStyles] Processing table style:', sid);

          // A. Base Table Borders from tblPr > tblBorders
          // Only get direct tblBorders children of this style's tblPr, not nested ones
          const tblPrNodes = styleNode.getElementsByTagName('w:tblPr');
          if (tblPrNodes.length > 0) {
            const tblPr = tblPrNodes[0];
            const tblBorders = tblPr.getElementsByTagName('w:tblBorders')[0];
            if (tblBorders) {
              const borderDirs = ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'];
              const borderParts: string[] = [];

              borderDirs.forEach(dir => {
                const borderNode = tblBorders.getElementsByTagName(`w:${dir}`)[0];
                if (borderNode) {
                  const borderCss = parseBorder(borderNode, themeMap);
                  if (borderCss) {
                    if (dir === 'insideH') {
                      borderParts.push(`border-top: ${borderCss} !important`);
                      borderParts.push(`border-bottom: ${borderCss} !important`);
                    } else if (dir === 'insideV') {
                      borderParts.push(`border-left: ${borderCss} !important`);
                      borderParts.push(`border-right: ${borderCss} !important`);
                    } else {
                      borderParts.push(`border-${dir}: ${borderCss} !important`);
                    }
                  }
                }
              });

              if (borderParts.length > 0) {
                const rule = `${baseSelector} td, ${baseSelector} th { ${borderParts.join('; ')}; }`;
                cssRules.push(rule);
                console.log('[useDocxStyles]   Border rule:', rule);
              }
            }
          }

          // B. Conditional Table Styles (firstRow, band1Vert, etc.)
          const tblStylePrs = Array.from(styleNode.getElementsByTagName('w:tblStylePr'));
          console.log('[useDocxStyles]   Found', tblStylePrs.length, 'conditional style entries');

          tblStylePrs.forEach(tblStylePr => {
            const type = tblStylePr.getAttribute('w:type');
            if (!type || !TBL_STYLE_MAP[type]) {
              console.log('[useDocxStyles]     Skipping unknown type:', type);
              return;
            }

            const pseudoSelector = TBL_STYLE_MAP[type];
            const styleParts: string[] = [];

            // Shading (Background Color)
            const shd = tblStylePr.getElementsByTagName('w:shd')[0];
            if (shd) {
              const fill = resolveColor(shd.getAttribute('w:fill'), shd.getAttribute('w:themeFill'), themeMap);
              if (fill && fill !== '#none' && fill !== '#clear') {
                styleParts.push(`background-color: ${fill} !important`);
              }
            }

            // Text Color & Bold from rPr
            const rPr = tblStylePr.getElementsByTagName('w:rPr')[0];
            if (rPr) {
              const colorNode = rPr.getElementsByTagName('w:color')[0];
              if (colorNode) {
                const color = resolveColor(colorNode.getAttribute('w:val'), colorNode.getAttribute('w:themeColor'), themeMap);
                if (color) {
                  styleParts.push(`color: ${color} !important`);
                }
              }
              const bNode = rPr.getElementsByTagName('w:b')[0];
              if (bNode && bNode.getAttribute('w:val') !== '0') {
                styleParts.push(`font-weight: bold !important`);
              }
            }

            // Cell-specific borders from tcPr > tcBorders
            const tcPr = tblStylePr.getElementsByTagName('w:tcPr')[0];
            if (tcPr) {
              const tcBorders = tcPr.getElementsByTagName('w:tcBorders')[0];
              if (tcBorders) {
                ['top', 'bottom', 'left', 'right'].forEach(dir => {
                  const borderNode = tcBorders.getElementsByTagName(`w:${dir}`)[0];
                  if (borderNode) {
                    const borderCss = parseBorder(borderNode, themeMap);
                    if (borderCss) {
                      styleParts.push(`border-${dir}: ${borderCss} !important`);
                    }
                  }
                });
              }
              // Cell shading inside tcPr
              const tcShd = tcPr.getElementsByTagName('w:shd')[0];
              if (tcShd) {
                const fill = resolveColor(tcShd.getAttribute('w:fill'), tcShd.getAttribute('w:themeFill'), themeMap);
                if (fill && fill !== '#none' && fill !== '#clear') {
                  styleParts.push(`background-color: ${fill} !important`);
                }
              }
            }

            if (styleParts.length > 0) {
              const rule = `${baseSelector} ${pseudoSelector} { ${styleParts.join('; ')}; }`;
              cssRules.push(rule);
              console.log('[useDocxStyles]     Conditional rule for', type, ':', rule);
            }
          });
        });

        if (cancelled) return;

        console.log('[useDocxStyles] Total CSS rules generated:', cssRules.length);
        
        // Always inject - even if 0 rules, remove old styles
        let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = STYLE_ELEMENT_ID;
          document.head.appendChild(styleEl);
        }
        
        const cssText = cssRules.join('\n');
        styleEl.textContent = cssText;
        console.log('[useDocxStyles] Injected CSS:\n', cssText);

        // Also log current tables in DOM for debugging
        const tables = document.querySelectorAll('.ProseMirror table');
        console.log('[useDocxStyles] Current tables in DOM:', tables.length);
        tables.forEach((t, i) => {
          console.log(`[useDocxStyles]   Table ${i}: data-style-id="${t.getAttribute('data-style-id')}", class="${t.className}"`);
        });

      } catch (err) {
        console.error('[useDocxStyles] Fatal error during parsing:', err);
      }
    };

    parseAndInject();

    return () => {
      cancelled = true;
    };
  }, [documentBuffer]);
};
