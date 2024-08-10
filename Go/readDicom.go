package main

import (
	"fmt"
	"os"
	"path/filepath"

	dicom "github.com/suyashkumar/dicom"
)

func fromFilepath(path string) (dicom.Dataset, error) {
	data, err := dicom.ParseFile(path, nil)

	if err != nil {
		fmt.Println("Error reading DICOM file at path:", path)
		fmt.Println(err)
	}

	return data, err
}

func fromDirectory(directory string) ([]dicom.Dataset, error) {
	filepaths, err := collectDicomPaths(directory)

	if err != nil {
		fmt.Println("Error reading DICOM files from directory:", directory)
		return []dicom.Dataset{}, err
	}

	var dataSets []dicom.Dataset

	for _, filepath := range filepaths {
		dataSet, err := fromFilepath(filepath)
		if err != nil {
			fmt.Println("Error reading DICOM file at path:", filepath)
			fmt.Println(err)
			continue
		}
		fmt.Println("Reading DICOM file at path:", filepath, dataSet)
		dataSets = append(dataSets, dataSet)
	}

	return dataSets, nil
}

func collectDicomPaths(directory string) ([]string, error) {
	var paths []string

	files, err := os.ReadDir(directory)

	if err != nil {
		return nil, err
	}

	for _, path := range files {
		fullPath := filepath.Join(directory, path.Name())

		fmt.Println("Checking path:", fullPath)

		if path.IsDir() {
			subPaths, err := collectDicomPaths(fullPath)
			if err != nil {
				return nil, err
			}
			paths = append(paths, subPaths...)
		} else if filepath.Ext(path.Name()) == ".dcm" {
			paths = append(paths, fullPath)
		}
	}

	return paths, nil
}
