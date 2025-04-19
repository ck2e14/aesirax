package main

import (
	"fmt"
	"net"
	"os"
	"syscall"
)

func checkError(err error, message string) {
	if err != nil {
		fmt.Println(message, err)
		os.Exit(1)
	}
}

func server(run bool) {
	if !run {
		return
	}

	// Create a new TCP socket
	// syscall.Socket: Creates a new socket.
	// syscall.AF_INET: Specifies the address family (IPv4).
	// syscall.SOCK_STREAM: Specifies the socket type (TCP).
	// syscall.IPPROTO_TCP: Specifies the protocol (TCP).
	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, syscall.IPPROTO_TCP)
	checkError(err, "Socket creation failed")

	// Set socket options...
	// fd is the int that identifies the socket we created
	// syscall.SOL_SOCKET informs what level we are setting this at
	// syscall.SO_REUSEADDR this is needed for dev especially as we will stop and start this a bunch of times
	// and without it we will get problems trying to reuse a recently used socket for the same address.
	// Also allows handling binding multiple sockets to the same port.
	// 1 -> enables the option.
	err = syscall.SetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)
	checkError(err, "Setting SO_REUSEADDR failed")

	// Create an address for the socket
	sockaddr := &syscall.SockaddrInet4{Port: 8080}

	// Cast the IPv4 address to a 4-byte representation
	ip := net.ParseIP("127.0.0.1").To4()

	// Copy the IP address to the Addr property of sockaddr
	copy(sockaddr.Addr[:], ip)

	// Bind the socket to the address
	err = syscall.Bind(fd, sockaddr)
	checkError(err, "Bind failed")

	// Listen for incoming connections
	// syscall.SOMAXCONN lets the OS decide the maximum length for the queue of pending connections.
	err = syscall.Listen(fd, syscall.SOMAXCONN)
	checkError(err, "Listen failed")

	fmt.Println("Server is listening on port 8080")

	// Accept loop - runs permanently and palms the handling off to a go routine
	for {
		connFd, peerSocketAddr, err := syscall.Accept(fd)
		checkError(err, "Error accepting connection")
		fmt.Println("New connection accepted from peer address", peerSocketAddr)
		go handleConnection(connFd)
	}
}

func handleConnection(connFd int) {
	// Ensure the socket is closed when the function exits
	defer syscall.Close(connFd)

	// Buffer to hold the entire message
	var totalMessageBuffer []byte

	// Buffer to read chunks of data
	buf := make([]byte, 1024)

	for {
		// Read data into the buffer
		n, err := syscall.Read(connFd, buf)
		if err != nil {
			if err == syscall.EAGAIN || err == syscall.EWOULDBLOCK {
				fmt.Println("No more data to read")
				break
			}
			checkError(err, "Error reading from connection")

			return
		}

		if n == 0 {
			// Connection closed by client
			fmt.Println("Connection closed by client")
			break
		}

		// Append the bytes read to totalMessageBuffer
		totalMessageBuffer = append(totalMessageBuffer, buf[:n]...)
	}

	// Write the dicom buffer to a file
	err := os.WriteFile("dicom_file.dcm", totalMessageBuffer, 0644)
	checkError(err, "Error writing to file")
}
