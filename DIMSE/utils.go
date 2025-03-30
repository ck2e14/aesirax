package main

import (
	// "bytes"
	// "encoding/json"
	// "fmt"
	dicom "github.com/suyashkumar/dicom"
	"log"
	"os"
	// "os/exec"
	"path/filepath"
	// "strings"
	// "sync"
	// "time"
)

func readDICOM(path string) (dicom.Dataset, error) {

	log.Println("Reading DICOM file at path:", path)
	return dicom.ParseFile(path, nil)
}

func findDICOM(path string) ([]string, error) {
	var paths []string

	files, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	for _, file := range files {
		fullPath := filepath.Join(path, file.Name())

		if file.IsDir() {
			subPaths, err := findDICOM(fullPath)
			if err != nil {
				return nil, err
			}

			paths = append(paths, subPaths...)
		} else if filepath.Ext(file.Name()) == ".dcm" {
			paths = append(paths, fullPath)
		}
	}

	return paths, nil
}

// func classifyPath(path string) string {
// 	info, err := os.Stat(path)

// 	if err != nil {
// 		if os.IsNotExist(err) {
// 			return "not a dir or a file"
// 		}
// 		return "error classifying"
// 	}

// 	if info.IsDir() {
// 		return "directory"
// 	}

// 	return "file"
// }

// func runShellCmd(cmd string, args ...string) (stdout string, stderr string, err error) {
// 	command := exec.Command(cmd, args...)

// 	var outb, errb bytes.Buffer

// 	command.Stdout = &outb
// 	command.Stderr = &errb
// 	err = command.Run()

// 	return outb.String(), errb.String(), err
// }

// // only 1 study per dir
// func collectImgTags(studyPath string) ([]dicom.Dataset, error) {
// 	start := time.Now()

// 	files, err := os.ReadDir(studyPath)
// 	if err != nil {
// 		fmt.Println("Error reading directory:", err)
// 		return nil, err
// 	}

// 	var wg sync.WaitGroup

// 	resultCh := make(chan dicom.Dataset, len(files))

// 	for _, file := range files {
// 		if !file.IsDir() && strings.HasSuffix(file.Name(), ".dcm") {
// 			wg.Add(1)
// 			go wg_dicomTagsNoPixels(studyPath+file.Name(), &wg, resultCh)
// 		}
// 	}

// 	go func() {
// 		wg.Wait()
// 		close(resultCh)
// 	}()

// 	var allResults []dicom.Dataset

// 	for r := range resultCh {
// 		allResults = append(allResults, r)
// 	}

// 	elapsed := time.Since(start)

// 	fmt.Println(fmt.Sprintf("[ parsed %d images' datasets in %v ] ", len(allResults), elapsed))

// 	return allResults, nil

// }

// // func collectImgTagsJson(studyPath string) ([]string, error) {
// // 	start := time.Now()

// // 	files, err := os.ReadDir(studyPath)
// // 	if err != nil {
// // 		fmt.Println("Error reading directory:", err)
// // 		return nil, err
// // 	}

// // 	var wg sync.WaitGroup
// // 	resultCh := make(chan dicom.Dataset, len(files))

// // 	for _, file := range files {
// // 		if !file.IsDir() && strings.HasSuffix(file.Name(), ".dcm") {
// // 			wg.Add(1)
// // 			go wg_dicomTagsNoPixels(studyPath+file.Name(), &wg, resultCh)
// // 		}
// // 	}

// // 	go func() {
// // 		wg.Wait()
// // 		close(resultCh)
// // 	}()

// // 	var allResults []dicom.Dataset
// // 	for r := range resultCh {
// // 		allResults = append(allResults, r)
// // 	}

// // 	elapsed := time.Since(start)
// // 	fmt.Println(fmt.Sprintf("[ parsed %d images' datasets in %v ] ", len(allResults), elapsed))

// // 	return allResults, nil

// // }

// // TODO make generic
// func printMap(obj map[string]interface{}) {
// 	println("{")

// 	for key, value := range obj {
// 		fmt.Println("  %s: %s,\n", key, value)
// 	}

// 	println("}")
// }

// func printSlice[T any](s []T) {
// 	for _, v := range s {
// 		fmt.Println(v)
// 	}
// }

// func getVal(dataset dicom.Dataset, tagNumber string) string {
// 	for _, element := range dataset.Elements {
// 		if element.Tag.String() == tagNumber {
// 			return element.Tag.String()
// 		}
// 	}

// 	return ""
// }

// func getTag(dataset dicom.Dataset, tagNumber string) dicom.Element {

// 	for _, element := range dataset.Elements {
// 		if element.Tag.String() == tagNumber {
// 			return *element
// 		}
// 	}

// 	return dicom.Element{}
// }

// func wg_dicomTagsNoPixels(imgPath string, wg *sync.WaitGroup, resultCh chan<- dicom.Dataset) (dicom.Dataset, error) {
// 	defer wg.Done()

// 	dataset, err := dicom.ParseFile(imgPath, nil, dicom.SkipPixelData())
// 	if err != nil {
// 		log.Printf("Error parsing DICOM file: %v", err)
// 		return dicom.Dataset{}, nil
// 	}

// 	resultCh <- dataset
// 	return dataset, nil
// }

// func dicomTagsNoPixels(imgPath string) (dicom.Dataset, error) {

// 	dataset, err := dicom.ParseFile(imgPath, nil, dicom.SkipPixelData())
// 	if err != nil {
// 		log.Println("Error parsing DICOM file: %v", err)
// 		return dicom.Dataset{}, err
// 	}

// 	return dataset, nil
// }

// func jsonTags(imgPath string) ([]byte, error) {
// 	dataset, err := dicomTagsNoPixels(imgPath)
// 	if err != nil {
// 		fmt.Println(err)

// 	}
// 	j, _ := json.Marshal(dataset)
// 	return j, nil
// }

// // func getTag(d dicom.Dataset) (dicom.Element, error) {
// // 	tag, err := d.FindElementByTag(00181000)
// // 	if err != nil {
// // 		fmt.Println(err)
// // 	} else {
// // 		fmt.Println(tag)
// // 	}
// // }
