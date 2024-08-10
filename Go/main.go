package main

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"log"
	"os"
)

func main() {
	server(false)

	filepath := "./data/report_structured_report_PI-Contrast.dcm"

	file, err := os.Open(filepath)
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	reader := bufio.NewReader(file)
	_, err = file.Seek(132, 0) // like a built in cursor for the next Read
	if err != nil {
		fmt.Println("Error seeking file:", err)
		return
	}

	for {
		var groupNumber, elementNumber uint16

		err = binary.Read(reader, binary.LittleEndian, &groupNumber)
		if err != nil {
			log.Fatal(err)
			break
		}

		err = binary.Read(reader, binary.LittleEndian, &elementNumber)
		if err != nil {
			log.Fatal(err)
			break
		}

		vr := make([]byte, 2)
		_, err = reader.Read(vr)
		if err != nil {
			fmt.Println("Error reading VR:", err)
			break
		}

		var length uint32
		err = binary.Read(reader, binary.LittleEndian, &length)
		if err != nil {
			fmt.Println("Error reading length:", err)
			break
		}

		value := make([]byte, length)
		_, err = reader.Read(value)
		if err != nil {
			fmt.Println("Error reading value:", err)
			break
		}

		fmt.Printf("Tag (%04x,%04x), VR: %s, Length: %d %b  ", groupNumber, elementNumber, vr, length, value)

	}

}

// func readTags(buf []byte) []string {
// 	for _, byte := range buf {
// 		fmt.Println("byte: ", string(byte))
// 	}
// 	return []string{}
// }

// func readDicomToMemory(path string) ([]byte, error) {
// 	file, err := os.Open(path)
// 	if err != nil {
// 		panic(err)
// 	}
// 	defer file.Close()

// 	stat, err := file.Stat()
// 	if err != nil {
// 		panic(err)
// 	}

// 	buffer := make([]byte, stat.Size())
// 	file.Read(buffer)

// 	// check if content of preamble is all zeroes
// 	for _, b := range make([]byte, 128) {
// 		if b != 0 {
// 			return nil, fmt.Errorf("preamble is not all zeroes")
// 		}
// 	}

// 	// check if the next 4 bytes are "DICM"
// 	if string(buffer[128:132]) != "DICM" {
// 		return nil, fmt.Errorf("missing DICM header")
// 	}

// 	// return beyond the preamble and DICM
// 	return buffer[132:], nil
// }
