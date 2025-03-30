// XSS Detection Plugin
// registerPlugin({
//   name: "XSS Payload Detector",
//   execution: "sync", // Security checks should be synchronous
//   stages: {
//     onValue: (element, buffer, context) => {
//       // Only check string values
//       if (typeof element.value === "string") {
//         const value = element.value;
//
//         // Check for common XSS patterns
//         const xssPatterns = [
//           /<script\b[^>]*>/i,
//           /javascript:/i,
//           /on\w+\s*=/i,
//           /eval\s*\(/i,
//           /<img[^>]+src[^>]*=/i,
//           /<iframe[^>]*>/i
//         ];
//
//         for (const pattern of xssPatterns) {
//           if (pattern.test(value)) {
//             console.warn(`Potential XSS payload detected in ${element.tag} (${element.name}): ${value.substring(0, 50)}...`);
//             // Log details, possibly trigger alerts
//
//             // You could also set a flag in the context
//             context.securityIssues = context.securityIssues || [];
//             context.securityIssues.push({
//               type: "XSS",
//               element: element.tag,
//               name: element.name,
//               sample: value.substring(0, 100)
//             });
//           }
//         }
//       }
//     },
//
//     afterParse: (element, buffer, context) => {
//       // Final report on security issues
//       if (context.securityIssues?.length > 0) {
//         console.error(`Found ${context.securityIssues.length} potential security issues in DICOM file`);
//         // Could trigger more comprehensive reporting here
//       }
//     }
//   }
// });
